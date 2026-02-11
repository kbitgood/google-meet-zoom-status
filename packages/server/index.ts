import { ZoomAutomator } from './zoom-automator';

const PORT = Number.parseInt(process.env.ZOOM_AUTOMATOR_PORT ?? '17394', 10);
const DATA_DIR = process.env.ZOOM_AUTOMATOR_DATA_DIR;
const IDLE_TIMEOUT_SECONDS = Number.parseInt(
  process.env.ZOOM_AUTOMATOR_IDLE_TIMEOUT_SECONDS ?? '600',
  10
);

const automator = new ZoomAutomator(DATA_DIR);

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
): void {
  const payload = {
    ts: new Date().toISOString(),
    component: 'ZoomAutomatorServer',
    level,
    message,
    ...(extra ?? {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function handleError(error: unknown, status = 500, requestId?: string): Response {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const stack = error instanceof Error ? error.stack : undefined;
  const snapshot = automator.getStatus();
  log('error', 'request failed', {
    requestId,
    status,
    message,
    stack,
    automatorStatus: snapshot,
  });

  return jsonResponse(
    {
      success: false,
      error: message,
      requestId,
      automatorState: snapshot.status,
      automatorMessage: snapshot.message,
      authenticated: snapshot.authenticated,
      inMeeting: snapshot.inMeeting,
    },
    status
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  async fetch(req): Promise<Response> {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    log('info', 'request start', {
      requestId,
      method,
      path: url.pathname,
    });

    try {
      if (method === 'GET' && url.pathname === '/health') {
        const status = automator.getStatus();
        return jsonResponse({
          success: true,
          requestId,
          service: 'zoom-automator',
          version: '2.0.0',
          inMeeting: status.inMeeting,
          authenticated: status.authenticated,
          state: status.status,
          message: status.message,
        });
      }

      if (method === 'GET' && url.pathname === '/status') {
        const status = automator.getStatus();
        const statusLabel =
          status.status === 'starting'
            ? 'Starting'
            : status.status === 'auth_required'
              ? 'Auth Required'
              : status.status === 'error'
                ? 'Error'
                : status.inMeeting
                  ? 'In Meeting'
                  : 'Available';
        return jsonResponse({
          success: true,
          requestId,
          status: statusLabel,
          state: status.status,
          inMeeting: status.inMeeting,
          authenticated: status.authenticated,
          message: status.message,
        });
      }

      if (method === 'POST' && url.pathname === '/auth/login') {
        await automator.interactiveLogin();
        return jsonResponse({
          success: true,
          requestId,
          message: 'Zoom login completed and saved in persistent profile',
        });
      }

      if (method === 'POST' && url.pathname === '/meeting/join') {
        await automator.joinMeeting();
        return jsonResponse({
          success: true,
          requestId,
          message: 'Zoom automation meeting started',
        });
      }

      if (method === 'POST' && url.pathname === '/meeting/leave') {
        await automator.leaveMeeting();
        return jsonResponse({
          success: true,
          requestId,
          message: 'Zoom automation meeting ended',
        });
      }

      if (method === 'POST' && url.pathname === '/shutdown') {
        await automator.dispose();
        return jsonResponse({ success: true, requestId, message: 'Shutting down' });
      }

      return jsonResponse({ success: false, requestId, error: 'Not found' }, 404);
    } catch (error) {
      const isAuthError =
        error instanceof Error && /login required|auth_required/i.test(error.message);
      return handleError(error, isAuthError ? 401 : 500, requestId);
    } finally {
      log('info', 'request end', {
        requestId,
        method,
        path: url.pathname,
        durationMs: Date.now() - startedAt,
      });
    }
  },
});

const shutdown = async (): Promise<void> => {
  log('info', 'shutdown start');
  await automator.dispose().catch((error) => {
    log('warn', 'dispose failed during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  server.stop(true);
  log('info', 'shutdown complete');
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

log('info', `listening`, {
  url: `http://127.0.0.1:${PORT}`,
  idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
});
