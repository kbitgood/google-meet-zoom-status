import {
  chromium,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
} from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type AutomatorStatus =
  | 'available'
  | 'in_meeting'
  | 'auth_required'
  | 'starting'
  | 'error';

export interface StatusResponse {
  status: AutomatorStatus;
  authenticated: boolean | null;
  inMeeting: boolean;
  message?: string;
}

const ZOOM_HOME_URL = 'https://app.zoom.us/wc/home';
const ZOOM_SIGNIN_URL = 'https://app.zoom.us/signin';
const DEBUG_DIR = process.env.ZOOM_AUTOMATOR_DEBUG_DIR ?? '/tmp/zoom-automator-debug';

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export class ZoomAutomator {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly userDataDir: string;
  private inAutomationMeeting = false;
  private authenticated: boolean | null = null;
  private state: AutomatorStatus = 'available';
  private lastMessage = 'Idle';
  private operationQueue: Promise<unknown> = Promise.resolve();
  private contextClosing: Promise<void> | null = null;
  private readonly instrumentedPages = new WeakSet<Page>();
  private snapshotCounter = 0;

  constructor(dataDir?: string) {
    this.userDataDir =
      dataDir ?? join(homedir(), '.zoom-automator', 'playwright-profile');
    ensureDir(this.userDataDir);
    this.log('info', 'initialized automator', { userDataDir: this.userDataDir });
  }

  getStatus(): StatusResponse {
    return {
      status: this.state,
      authenticated: this.authenticated,
      inMeeting: this.inAutomationMeeting,
      message: this.lastMessage,
    };
  }

  async interactiveLogin(timeoutMs = 10 * 60 * 1000): Promise<void> {
    return this.enqueue(async () => {
      this.log('info', 'interactiveLogin start', { timeoutMs });
      this.state = 'starting';
      this.lastMessage = 'Waiting for interactive login';
      await this.closeContext();
      await this.ensureContext(false);
      const page = await this.getPage();

      await page.goto(ZOOM_SIGNIN_URL, { waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const loggedIn = await this.detectAuthenticated(page);
        if (loggedIn) {
          this.authenticated = true;
          this.state = this.inAutomationMeeting ? 'in_meeting' : 'available';
          this.lastMessage = 'Login completed';
          this.log('info', 'interactiveLogin authenticated');
          await this.closeContext();
          return;
        }
        await page.waitForTimeout(1500);
      }

      this.authenticated = false;
      this.state = 'auth_required';
      this.lastMessage = 'Login timed out before completion';
      this.log('warn', 'interactiveLogin timeout');
      throw new Error('Timed out waiting for Zoom login completion');
    });
  }

  async joinMeeting(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.log('info', 'joinMeeting start');
        if (this.inAutomationMeeting) {
          this.state = 'in_meeting';
          this.lastMessage = 'Automation meeting already running';
          this.log('info', 'joinMeeting already active');
          return;
        }

        this.state = 'starting';
        this.lastMessage = 'Starting automation meeting';

        let joined = false;
        let lastAttemptError: unknown = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            await this.ensureContext(true);
            this.log('debug', 'joinMeeting context ready', { attempt });
            const page = await this.getPage();

            const isAuthed = await this.ensureAuthenticated(page);
            if (!isAuthed) {
              this.authenticated = false;
              this.state = 'auth_required';
              this.lastMessage =
                'Zoom login required. Run POST /auth/login and complete MFA once.';
              this.log('warn', 'joinMeeting auth required');
              throw new Error(this.lastMessage);
            }

            this.log('debug', 'joinMeeting navigate home', { attempt });
            await page.goto(ZOOM_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1000);

            this.log('debug', 'joinMeeting disable PMI', { attempt });
            await this.withTimeout(
              this.disableUsePmi(page),
              8000,
              'Timed out disabling Use PMI option'
            );
            this.log('debug', 'joinMeeting start new meeting click', { attempt });
            const meetingPage = await this.withTimeout(
              this.startNewMeeting(page),
              12000,
              'Timed out starting new meeting'
            );
            this.log('debug', 'joinMeeting active page selected', {
              currentUrl: meetingPage.url(),
              attempt,
            });
            this.log('debug', 'joinMeeting ensure mic/camera off', { attempt });
            try {
              await this.withTimeout(
                this.ensureMicAndCameraOff(meetingPage),
                8000,
                'Timed out ensuring mic/camera are off'
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.log('warn', 'joinMeeting mic/camera prep skipped', {
                attempt,
                message,
              });
            }
            this.log('debug', 'joinMeeting wait for meeting started', { attempt });
            await this.withTimeout(
              this.waitForMeetingStarted(meetingPage),
              30000,
              'Timed out waiting for meeting-start checks'
            );

            joined = true;
            break;
          } catch (error) {
            lastAttemptError = error;
            const message = error instanceof Error ? error.message : String(error);
            const retryable = this.isRetryableJoinTimeout(error);
            this.log('warn', 'joinMeeting attempt failed', {
              attempt,
              retryable,
              message,
            });

            await this.closeContext().catch((closeError) => {
              const closeMessage =
                closeError instanceof Error ? closeError.message : String(closeError);
              this.log('warn', 'joinMeeting attempt cleanup closeContext failed', {
                closeMessage,
                attempt,
              });
            });

            if (!retryable || attempt >= 2) {
              throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        }

        if (!joined) {
          throw lastAttemptError instanceof Error
            ? lastAttemptError
            : new Error('Join attempt did not complete');
        }

        this.inAutomationMeeting = true;
        this.authenticated = true;
        this.state = 'in_meeting';
        this.lastMessage = 'Automation meeting is active';
        this.log('info', 'joinMeeting success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (this.state !== 'auth_required') {
          this.state = 'error';
          this.lastMessage = `Failed to start automation meeting: ${message}`;
        }
        this.log('error', 'joinMeeting failed', { message });
        // Ensure failed join does not leave a stuck browser context behind.
        await this.closeContext().catch((closeError) => {
          const closeMessage =
            closeError instanceof Error ? closeError.message : String(closeError);
          this.log('warn', 'joinMeeting cleanup closeContext failed', {
            closeMessage,
          });
        });
        throw error;
      }
    });
  }

  private isRetryableJoinTimeout(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return /goto: Timeout|Timeout \d+ms exceeded|Timed out/i.test(error.message);
  }

  async leaveMeeting(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.log('info', 'leaveMeeting start');
        if (!this.context) {
          this.inAutomationMeeting = false;
          this.state = this.authenticated === false ? 'auth_required' : 'available';
          this.lastMessage = 'No active browser session';
          this.log('info', 'leaveMeeting no active context');
          return;
        }

        this.state = 'starting';
        this.lastMessage = 'Closing automation browser session';

        await this.closeContext();
        await new Promise((resolve) => setTimeout(resolve, 400));

        this.inAutomationMeeting = false;
        this.state = this.authenticated === false ? 'auth_required' : 'available';
        this.lastMessage = 'Automation meeting ended and browser session closed';
        this.log('info', 'leaveMeeting success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.state = 'error';
        this.lastMessage = `Failed to end automation meeting: ${message}`;
        this.log('error', 'leaveMeeting failed', { message });
        throw error;
      }
    });
  }

  async dispose(): Promise<void> {
    await this.enqueue(async () => {
      this.log('info', 'dispose start');
      await this.closeContext();
      this.inAutomationMeeting = false;
      this.state = 'available';
      this.lastMessage = 'Stopped';
      this.log('info', 'dispose complete');
    });
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(fn, fn);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureContext(headless: boolean): Promise<void> {
    if (this.contextClosing) {
      await this.contextClosing;
      this.contextClosing = null;
    }

    if (this.context) {
      return;
    }

    this.log('debug', 'ensureContext launch persistent', { headless });
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless,
      viewport: { width: 1440, height: 900 },
    });
    this.context.on('page', (page) => {
      this.instrumentPage(page);
    });
    for (const existingPage of this.context.pages()) {
      this.instrumentPage(existingPage);
    }

    this.context.on('close', () => {
      this.log('debug', 'context close event');
      this.context = null;
      this.page = null;
      this.inAutomationMeeting = false;
    });
  }

  private async getPage(): Promise<Page> {
    if (!this.context) {
      throw new Error('Browser context is not initialized');
    }

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const existing = this.context.pages()[0];
    this.page = existing ?? (await this.context.newPage());
    return this.page;
  }

  private async closeContext(): Promise<void> {
    if (this.context) {
      const context = this.context;
      this.context = null;
      this.page = null;
      this.inAutomationMeeting = false;

      this.log('debug', 'closeContext begin');
      const closePromise = context.close().catch(() => undefined);
      this.contextClosing = closePromise;

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Timed out waiting for context.close()'));
        }, 10000);
      });

      try {
        await Promise.race([closePromise, timeoutPromise]);
        this.log('debug', 'closeContext complete');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log('warn', 'closeContext timeout, attempting browser close', {
          message,
        });
        const browser = context.browser();
        if (browser) {
          const browserClosePromise = browser.close().catch(() => undefined);
          const browserTimeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Timed out waiting for browser.close()'));
            }, 5000);
          });
          try {
            await Promise.race([browserClosePromise, browserTimeoutPromise]);
          } catch (browserCloseError) {
            const closeMessage =
              browserCloseError instanceof Error
                ? browserCloseError.message
                : String(browserCloseError);
            this.log('warn', 'fallback browser close timed out', {
              closeMessage,
            });
          }
        }
      } finally {
        this.contextClosing = null;
      }
    }
  }

  private async detectAuthenticated(page: Page): Promise<boolean> {
    const currentUrl = page.url();
    if (/signin|login|sso|mfa|verify/i.test(currentUrl)) {
      return false;
    }

    const signInButton = page.getByRole('button', { name: /sign in/i });
    if ((await signInButton.count()) > 0) {
      return false;
    }

    const signInLink = page.getByRole('link', { name: /sign in/i });
    if ((await signInLink.count()) > 0) {
      return false;
    }

    return true;
  }

  private async ensureAuthenticated(page: Page): Promise<boolean> {
    await page.goto(ZOOM_HOME_URL, { waitUntil: 'domcontentloaded' });
    const authed = await this.detectAuthenticated(page);
    this.authenticated = authed;
    return authed;
  }

  private async startNewMeeting(page: Page): Promise<Page> {
    const clicked = await this.tryClick(page, [
      () => page.getByRole('button', { name: /new meeting/i }).first(),
      () => page.getByRole('button', { name: /host a meeting/i }).first(),
      () => page.locator('button:has-text("New Meeting")').first(),
    ]);

    if (!clicked) {
      throw new Error('Unable to find a New Meeting button in Zoom web app');
    }

    let candidate = page;
    if (this.context) {
      const createdPage = await this.context
        .waitForEvent('page', { timeout: 4500 })
        .catch(() => null);
      if (createdPage) {
        await createdPage.waitForLoadState('domcontentloaded').catch(() => undefined);
        candidate = createdPage;
      }
    }

    await candidate.waitForTimeout(1200);
    await this.capturePageSnapshot(candidate, 'after-new-meeting-click');
    this.page = candidate;
    return candidate;
  }

  private async disableUsePmi(page: Page): Promise<void> {
    const menuOpened = await this.tryClick(page, [
      () => page.getByRole('button', { name: /new meeting options/i }).first(),
      () => page.getByRole('button', { name: /meeting options/i }).first(),
      () =>
        page
          .locator(
            'button[aria-haspopup="menu"][aria-label*="meeting" i], button[aria-haspopup="menu"][title*="meeting" i]'
          )
          .first(),
    ]);

    if (!menuOpened) {
      return;
    }

    await page.waitForTimeout(300);

    const pmiToggle = await this.findFirstVisible(page, [
      () => page.getByRole('menuitemcheckbox', { name: /use pmi/i }).first(),
      () => page.getByRole('checkbox', { name: /use pmi/i }).first(),
      () => page.locator('[role="menuitemcheckbox"]:has-text("Use PMI")').first(),
      () => page.locator('label:has-text("Use PMI")').first(),
    ]);

    if (!pmiToggle) {
      await page.keyboard.press('Escape').catch(() => undefined);
      return;
    }

    let isChecked = false;
    const ariaChecked = await pmiToggle.getAttribute('aria-checked');
    if (ariaChecked === 'true') {
      isChecked = true;
    } else if ((await pmiToggle.getAttribute('type')) === 'checkbox') {
      isChecked = await pmiToggle.isChecked().catch(() => false);
    }

    if (isChecked) {
      await pmiToggle.click({ timeout: 1500 });
      await page.waitForTimeout(200);
    }

    await page.keyboard.press('Escape').catch(() => undefined);
  }

  private async ensureMicAndCameraOff(page: Page): Promise<void> {
    await this.turnOffControl(page, /microphone|mic|audio/i, [
      () =>
        page
          .locator(
            'button[aria-pressed="true"][aria-label*="mic" i], button[aria-pressed="true"][aria-label*="microphone" i], button[aria-pressed="true"][aria-label*="audio" i]'
          )
          .first(),
    ]);
    await this.turnOffControl(page, /camera|video/i, [
      () =>
        page
          .locator(
            'button[aria-pressed="true"][aria-label*="camera" i], button[aria-pressed="true"][aria-label*="video" i]'
          )
          .first(),
    ]);
  }

  private async turnOffControl(
    page: Page,
    labelPattern: RegExp,
    fallbackSelectors: Array<() => Locator>
  ): Promise<void> {
    const candidates = [
      page
        .locator('button[aria-pressed="true"]')
        .filter({ hasText: labelPattern }),
      page
        .locator('button[aria-label]')
        .filter({ hasText: labelPattern })
        .filter({ hasText: /turn off|stop/i }),
    ];

    for (const locator of candidates) {
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.first().click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(150);
      return;
    }

    await this.tryClick(page, fallbackSelectors);
  }

  private async waitForMeetingStarted(initialPage: Page): Promise<void> {
    const deadline = Date.now() + 26000;
    let lastSnapshotLogAt = 0;

    while (Date.now() < deadline) {
      const page = this.findMostLikelyMeetingPage(initialPage);
      this.page = page;
      await this.handleMeetingEntryPrompts(page);
      await this.handleInMeetingPrompts(page);
      const currentUrl = page.url();
      const movedOffHome = !/\/wc\/home/i.test(currentUrl) && !/\/signin/i.test(currentUrl);
      const preJoinVisible = await this.hasPreJoinPrompt(page);
      const meetingUiFrameSignal = await this.findMeetingUiSignalAcrossFrames(page);
      const titleLooksInMeeting = /zoom meeting/i.test(await page.title().catch(() => ''));

      const inMeetingSignals: Array<{ name: string; locate: () => Locator; strong?: boolean }> = [
        {
          name: 'role-leave-end',
          locate: () => page.getByRole('button', { name: /leave|end/i }).first(),
          strong: true,
        },
        {
          name: 'text-leave-end',
          locate: () =>
            page.locator('button:has-text("Leave"), button:has-text("End")').first(),
          strong: true,
        },
        {
          name: 'testid-leave-end',
          locate: () => page.locator('[data-testid*="leave"], [data-testid*="end"]').first(),
          strong: true,
        },
        {
          name: 'host-now-banner',
          locate: () => page.getByText(/you are host now/i).first(),
          strong: true,
        },
        {
          name: 'controlbar-join-audio',
          locate: () => page.getByRole('button', { name: /join audio/i }).first(),
          strong: true,
        },
        {
          name: 'controlbar-start-video',
          locate: () => page.getByRole('button', { name: /start video/i }).first(),
          strong: true,
        },
        {
          name: 'controlbar-audio',
          locate: () => page.getByRole('button', { name: /^audio$/i }).first(),
          strong: true,
        },
        {
          name: 'controlbar-video',
          locate: () => page.getByRole('button', { name: /^video$/i }).first(),
          strong: true,
        },
        {
          name: 'meeting-banner-mic-cam',
          locate: () =>
            page
              .getByText(/please enable access to your microphone and camera/i)
              .first(),
          strong: true,
        },
      ];

      let matchedSignal: string | null = null;
      let matchedStrongSignal = false;
      if (meetingUiFrameSignal) {
        matchedSignal = `frame:${meetingUiFrameSignal}`;
        matchedStrongSignal = true;
      }
      for (const signal of inMeetingSignals) {
        if (matchedSignal) {
          break;
        }
        const visible = await this.findFirstVisible(page, [signal.locate], 350);
        if (visible) {
          matchedSignal = signal.name;
          matchedStrongSignal = signal.strong === true;
          break;
        }
      }

      if (!matchedSignal && titleLooksInMeeting && /\/wc\/\d+\/(start|join)/i.test(currentUrl)) {
        matchedSignal = 'title-zoom-meeting';
        matchedStrongSignal = true;
      }

      if (movedOffHome && matchedSignal && (matchedStrongSignal || !preJoinVisible)) {
        const diagnostics = await this.getPageDiagnostics(page);
        this.log('debug', 'waitForMeetingStarted success', {
          currentUrl,
          matchedSignal,
          matchedStrongSignal,
          preJoinVisible,
          ...diagnostics,
        });
        await this.capturePageSnapshot(page, 'meeting-start-detected');
        return;
      }

      if (Date.now() - lastSnapshotLogAt > 3000) {
        lastSnapshotLogAt = Date.now();
        const diagnostics = await this.getPageDiagnostics(page);
        this.log('debug', 'waitForMeetingStarted polling', {
          ...diagnostics,
          preJoinVisible,
          matchedSignal,
          matchedStrongSignal,
          titleLooksInMeeting,
          meetingUiFrameSignal,
        });
        await this.capturePageSnapshot(page, 'meeting-start-polling');
      }

      await page.waitForTimeout(250);
    }

    const diagnostics = await this.getPageDiagnostics(this.findMostLikelyMeetingPage(initialPage));
    this.log('error', 'waitForMeetingStarted timeout diagnostics', diagnostics);
    await this.capturePageSnapshot(this.findMostLikelyMeetingPage(initialPage), 'meeting-start-timeout');
    throw new Error('Zoom meeting did not reach an active state in time');
  }

  private async findMeetingUiSignalAcrossFrames(page: Page): Promise<string | null> {
    const meetingSignals: Array<{ name: string; pattern: RegExp }> = [
      { name: 'join-audio', pattern: /^join audio$/i },
      { name: 'start-video', pattern: /^start video$/i },
      { name: 'participants', pattern: /^participants$/i },
      { name: 'reactions', pattern: /^reactions$/i },
      { name: 'share-screen', pattern: /^share screen$/i },
      { name: 'security', pattern: /^security$/i },
      { name: 'ai-companion', pattern: /^ai companion$/i },
      { name: 'end', pattern: /^end$/i },
    ];

    for (const signal of meetingSignals) {
      const match = await this.findVisibleTextAcrossFrames(page, [signal.pattern], 180);
      if (match) {
        return signal.name;
      }
    }

    return null;
  }

  private findMostLikelyMeetingPage(fallback: Page): Page {
    if (!this.context) {
      return fallback;
    }

    const pages = this.context.pages().filter((page) => !page.isClosed());
    if (pages.length === 0) {
      return fallback;
    }

    for (const page of pages) {
      if (/\/wc\/\d+\/(start|join)/i.test(page.url())) {
        return page;
      }
    }

    for (const page of pages) {
      if (!/\/wc\/home/i.test(page.url()) && !/\/signin/i.test(page.url())) {
        return page;
      }
    }

    return pages[0] ?? fallback;
  }

  private async handleMeetingEntryPrompts(page: Page): Promise<void> {
    await this.tryClickActionAcrossFrames(page, [
      { label: 'start-this-meeting-frame', pattern: /start this meeting/i },
      {
        label: 'continue-without-mic-cam-frame',
        pattern: /continue without microphone and camera/i,
      },
    ]).catch(() => undefined);

    const entryPrompts: Array<{ label: string; locate: () => Locator }> = [
      {
        label: 'start-meeting',
        locate: () => page.getByRole('button', { name: /start meeting/i }).first(),
      },
      {
        label: 'start-this-meeting',
        locate: () => page.getByRole('button', { name: /start this meeting/i }).first(),
      },
      {
        label: 'start-this-meeting-css',
        locate: () =>
          page
            .locator(
              'button:has-text("Start this Meeting"), [role="button"]:has-text("Start this Meeting"), .zm-button--primary:has-text("Start this Meeting")'
            )
            .first(),
      },
      {
        label: 'join-meeting',
        locate: () => page.getByRole('button', { name: /join meeting/i }).first(),
      },
      {
        label: 'join-browser',
        locate: () =>
          page.getByRole('button', { name: /join from (your )?browser/i }).first(),
      },
      {
        label: 'continue-browser',
        locate: () => page.getByRole('button', { name: /continue in browser/i }).first(),
      },
      {
        label: 'launch-meeting',
        locate: () => page.getByRole('button', { name: /launch meeting/i }).first(),
      },
      {
        label: 'got-it',
        locate: () => page.getByRole('button', { name: /^got it$/i }).first(),
      },
      {
        label: 'agree',
        locate: () => page.getByRole('button', { name: /^i agree$/i }).first(),
      },
      {
        label: 'continue-without-mic-cam',
        locate: () =>
          page
            .getByRole('button', { name: /continue without microphone and camera/i })
            .first(),
      },
      {
        label: 'start-this-meeting',
        locate: () => page.getByRole('button', { name: /start this meeting/i }).first(),
      },
      {
        label: 'start-this-meeting-css',
        locate: () =>
          page
            .locator(
              'button:has-text("Start this Meeting"), [role="button"]:has-text("Start this Meeting"), .zm-button--primary:has-text("Start this Meeting")'
            )
            .first(),
      },
      {
        label: 'continue-without-mic-cam-text',
        locate: () => page.getByText(/continue without microphone and camera/i).first(),
      },
    ];

    const audioPrompts: Array<{ label: string; locate: () => Locator }> = [
      {
        label: 'join-audio-computer',
        locate: () =>
          page.getByRole('button', { name: /join audio by computer/i }).first(),
      },
      {
        label: 'join-computer-audio',
        locate: () =>
          page.getByRole('button', { name: /join with computer audio/i }).first(),
      },
      {
        label: 'join-audio',
        locate: () => page.getByRole('button', { name: /join audio/i }).first(),
      },
    ];

    await this.tryClickWithLog(page, entryPrompts).catch(() => undefined);
    await this.tryClickWithLog(page, audioPrompts).catch(() => undefined);
  }

  private async handleInMeetingPrompts(page: Page): Promise<void> {
    await this.tryClickActionAcrossFrames(page, [
      { label: 'start-this-meeting-frame', pattern: /start this meeting/i },
      {
        label: 'continue-without-mic-cam-frame',
        pattern: /continue without microphone and camera/i,
      },
      { label: 'floating-reactions-ok-frame', pattern: /^ok$/i },
    ]).catch(() => undefined);

    await this.tryClickWithLog(page, [
      {
        label: 'continue-without-mic-cam',
        locate: () =>
          page
            .getByRole('button', { name: /continue without microphone and camera/i })
            .first(),
      },
      {
        label: 'continue-without-mic-cam-text',
        locate: () => page.getByText(/continue without microphone and camera/i).first(),
      },
      {
        label: 'floating-reactions-ok',
        locate: () => page.getByRole('button', { name: /^ok$/i }).first(),
      },
      {
        label: 'join-audio-control',
        locate: () => page.getByRole('button', { name: /^join audio$/i }).first(),
      },
    ]).catch(() => undefined);
  }

  private async getPageDiagnostics(page: Page): Promise<Record<string, unknown>> {
    const currentUrl = page.url();
    const title = await page.title().catch(() => 'unknown');
    const buttons = await page
      .locator('button:visible')
      .evaluateAll((elements) =>
        elements
          .map((el) => (el.textContent ?? '').trim())
          .filter((text) => text.length > 0)
          .slice(0, 8)
      )
      .catch(() => []);

    return {
      currentUrl,
      title,
      visibleButtons: buttons,
      visibleHeadings: await page
        .locator('h1:visible, h2:visible, h3:visible')
        .evaluateAll((elements) =>
          elements
            .map((el) => (el.textContent ?? '').trim())
            .filter((text) => text.length > 0)
            .slice(0, 5)
        )
        .catch(() => []),
      pageCount: this.context?.pages().length ?? 0,
    };
  }

  private async hasPreJoinPrompt(page: Page): Promise<boolean> {
    const preJoinSignals = [
      () => page.getByRole('button', { name: /start meeting/i }).first(),
      () => page.getByRole('button', { name: /join meeting/i }).first(),
      () => page.getByRole('button', { name: /join from (your )?browser/i }).first(),
      () => page.getByRole('button', { name: /continue in browser/i }).first(),
      () => page.getByRole('button', { name: /launch meeting/i }).first(),
      () => page.getByText(/you are already in another meeting/i).first(),
      () => page.getByText(/start this meeting/i).first(),
    ];
    const visible = await this.findFirstVisible(page, preJoinSignals, 250);
    if (visible) {
      return true;
    }

    const crossFrameSignal = await this.findVisibleTextAcrossFrames(page, [
      /you are already in another meeting/i,
      /start this meeting/i,
      /continue without microphone and camera/i,
    ]);
    return crossFrameSignal !== null;
  }

  private async tryClick(page: Page, factories: Array<() => Locator>): Promise<boolean> {
    const locator = await this.findFirstVisible(page, factories);
    if (!locator) {
      return false;
    }

    await locator.click({ timeout: 2000 });
    return true;
  }

  private async tryClickWithLog(
    page: Page,
    entries: Array<{ label: string; locate: () => Locator }>
  ): Promise<boolean> {
    for (const entry of entries) {
      const locator = await this.findFirstVisible(page, [entry.locate], 500);
      if (!locator) {
        continue;
      }
      await locator.click({ timeout: 2000 });
      this.log('debug', 'click prompt', { label: entry.label, currentUrl: page.url() });
      await page.waitForTimeout(250).catch(() => undefined);
      return true;
    }
    return false;
  }

  private async tryClickActionAcrossFrames(
    page: Page,
    entries: Array<{ label: string; pattern: RegExp }>
  ): Promise<boolean> {
    for (const entry of entries) {
      const match = await this.findActionableAcrossFrames(page, entry.pattern, 800);
      if (!match) {
        continue;
      }
      await match.locator.click({ timeout: 2500 });
      this.log('debug', 'click actionable prompt across frames', {
        label: entry.label,
        currentUrl: page.url(),
        frameUrl: match.frame.url(),
        tagName: match.tagName,
      });
      await page.waitForTimeout(300).catch(() => undefined);
      return true;
    }
    return false;
  }

  private async findActionableAcrossFrames(
    page: Page,
    pattern: RegExp,
    timeoutMs = 700
  ): Promise<{ frame: Frame; locator: Locator; tagName: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const candidates: Array<{ locator: Locator; tagName: string }> = [
          { locator: frame.getByRole('button', { name: pattern }).first(), tagName: 'button-role' },
          { locator: frame.getByRole('link', { name: pattern }).first(), tagName: 'link-role' },
          {
            locator: frame.locator('button, [role="button"], a').filter({ hasText: pattern }).first(),
            tagName: 'css-actionable',
          },
          { locator: frame.getByText(pattern).first(), tagName: 'text' },
        ];
        for (const candidate of candidates) {
          if ((await candidate.locator.count().catch(() => 0)) === 0) {
            continue;
          }
          const visible = await candidate.locator.isVisible().catch(() => false);
          if (!visible) {
            continue;
          }
          return { frame, locator: candidate.locator, tagName: candidate.tagName };
        }
      }
      await page.waitForTimeout(120).catch(() => undefined);
    }
    return null;
  }

  private async findVisibleTextAcrossFrames(
    page: Page,
    patterns: RegExp[],
    timeoutMs = 500
  ): Promise<{ frame: Frame; locator: Locator } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        for (const pattern of patterns) {
          const candidate = frame.getByText(pattern).first();
          if ((await candidate.count().catch(() => 0)) === 0) {
            continue;
          }
          if (await candidate.isVisible().catch(() => false)) {
            return { frame, locator: candidate };
          }
        }
      }
      await page.waitForTimeout(120).catch(() => undefined);
    }
    return null;
  }

  private instrumentPage(page: Page): void {
    if (this.instrumentedPages.has(page)) {
      return;
    }
    this.instrumentedPages.add(page);

    page.on('console', (msg) => {
      const text = msg.text();
      if (!text) {
        return;
      }
      const type = msg.type();
      if (this.shouldSuppressConsole(type, text)) {
        return;
      }
      this.log('debug', 'playwright console', {
        url: page.url(),
        consoleType: type,
        text: text.slice(0, 500),
      });
    });
    page.on('pageerror', (error) => {
      this.log('warn', 'playwright pageerror', {
        url: page.url(),
        message: error.message,
      });
    });
    page.on('requestfailed', (request) => {
      this.log('debug', 'playwright requestfailed', {
        url: page.url(),
        requestUrl: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText,
      });
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.log('debug', 'playwright mainframe navigated', {
          url: frame.url(),
        });
      }
    });
  }

  private shouldSuppressConsole(type: string, text: string): boolean {
    if (type === 'log') {
      return true;
    }
    if (
      /Failed to execute 'postMessage' on 'DOMWindow'/i.test(text) ||
      /Amplitude Logger \[Warn\]: Network error occurred, event batch rejected/i.test(text) ||
      /The @zoom\/hybrid-jssdk only supports UnifyWebView/i.test(text) ||
      /Collector url is required/i.test(text) ||
      /No 'Access-Control-Allow-Origin' header is present/i.test(text)
    ) {
      return true;
    }
    return false;
  }

  private async capturePageSnapshot(page: Page, stage: string): Promise<void> {
    try {
      ensureDir(DEBUG_DIR);
      this.snapshotCounter += 1;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${stamp}-${this.snapshotCounter}-${stage}.png`;
      const path = join(DEBUG_DIR, fileName);
      await page.screenshot({ path, fullPage: true, timeout: 4000 });
      this.log('debug', 'captured page snapshot', {
        stage,
        path,
        url: page.url(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('warn', 'capture page snapshot failed', {
        stage,
        message,
      });
    }
  }

  private async findFirstVisible(
    page: Page,
    factories: Array<() => Locator>,
    timeoutMs = 2500
  ): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const make of factories) {
        const locator = make();
        if ((await locator.count()) === 0) {
          continue;
        }
        const first = locator.first();
        if (await first.isVisible().catch(() => false)) {
          return first;
        }
      }
      await page.waitForTimeout(150);
    }

    return null;
  }

  private async withTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([task, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    extra?: Record<string, unknown>
  ): void {
    const payload = {
      ts: new Date().toISOString(),
      component: 'ZoomAutomator',
      level,
      message,
      state: this.state,
      inMeeting: this.inAutomationMeeting,
      authenticated: this.authenticated,
      ...(extra ?? {}),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
      return;
    }
    console.log(line);
  }
}
