import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
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

        await this.ensureContext(true);
        this.log('debug', 'joinMeeting context ready');
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

        this.log('debug', 'joinMeeting navigate home');
        await page.goto(ZOOM_HOME_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        this.log('debug', 'joinMeeting disable PMI');
        await this.disableUsePmi(page);
        this.log('debug', 'joinMeeting start new meeting click');
        await this.startNewMeeting(page);
        this.log('debug', 'joinMeeting ensure mic/camera off');
        await this.ensureMicAndCameraOff(page);
        this.log('debug', 'joinMeeting wait for meeting started');
        await this.waitForMeetingStarted(page);

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
        throw error;
      }
    });
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
      this.log('debug', 'closeContext begin');
      const closing = this.context.close().catch(() => undefined);
      this.contextClosing = closing;
      await closing;
      this.context = null;
      this.page = null;
      this.log('debug', 'closeContext complete');
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

  private async startNewMeeting(page: Page): Promise<void> {
    const clicked = await this.tryClick(page, [
      () => page.getByRole('button', { name: /new meeting/i }).first(),
      () => page.getByRole('button', { name: /host a meeting/i }).first(),
      () => page.locator('button:has-text("New Meeting")').first(),
    ]);

    if (!clicked) {
      throw new Error('Unable to find a New Meeting button in Zoom web app');
    }

    await page.waitForTimeout(1200);
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

  private async waitForMeetingStarted(page: Page): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const currentUrl = page.url();
      const movedOffHome =
        !/\/wc\/home/i.test(currentUrl) && !/\/signin/i.test(currentUrl);

      const inMeetingSignals = [
        () => page.getByRole('button', { name: /leave|end/i }).first(),
        () => page.locator('button:has-text("Leave"), button:has-text("End")').first(),
        () => page.locator('[data-testid*="leave"], [data-testid*="end"]').first(),
      ];

      const signal = await this.findFirstVisible(page, inMeetingSignals, 900);
      if (movedOffHome && signal) {
        this.log('debug', 'waitForMeetingStarted success', { currentUrl });
        return;
      }

      await page.waitForTimeout(250);
    }

    throw new Error('Zoom meeting did not reach an active state in time');
  }

  private async tryClick(page: Page, factories: Array<() => Locator>): Promise<boolean> {
    const locator = await this.findFirstVisible(page, factories);
    if (!locator) {
      return false;
    }

    await locator.click({ timeout: 2000 });
    return true;
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
