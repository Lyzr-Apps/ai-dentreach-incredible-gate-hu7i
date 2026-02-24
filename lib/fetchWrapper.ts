import { isInIframe } from "@/components/ErrorBoundary";

const sendErrorToParent = (
  message: string,
  status?: number,
  endpoint?: string,
) => {
  console.error(`[FetchWrapper] ${message}`, { status, endpoint });

  if (isInIframe()) {
    window.parent.postMessage(
      {
        source: "architect-child-app",
        type: "CHILD_APP_ERROR",
        payload: {
          type: status && status >= 500 ? "api_error" : "network_error",
          message,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          endpoint,
          status,
        },
      },
      "*",
    );
  }
};

const fetchWrapper = async (...args) => {
  try {
    const response = await fetch(...args);

    // if backend sent a redirect
    if (response.redirected) {
      window.location.href = response.url; // update ui to go to the redirected UI (often /login)
      return;
    }

    // Tool authentication required on /api/agent - notify parent to open connection wizard
    if (response.status === 401) {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (requestUrl.includes("/api/agent")) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const cloned = response.clone();
          try {
            const body = await cloned.json();
            if (body?.detail?.type === "tool_auth" && isInIframe()) {
              const detail = body.detail;
              window.parent.postMessage(
                {
                  source: "architect-child-app",
                  type: "TOOL_AUTH_REQUIRED",
                  payload: {
                    tool_name: detail.tool_name,
                    tool_source: detail.tool_source,
                    action_names: detail.action_names,
                    reason: detail.reason,
                  },
                },
                "*",
              );
            }
          } catch {
            // JSON parse failed, ignore
          }
        }
      }
      return response;
    }

    if (response.status == 404) {
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        const html = await response.text();

        // Replace entire current page with returned HTML
        document.open();
        document.write(html);
        document.close();

        return;
      } else {
        const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        sendErrorToParent(
          `Backend returned 404 Not Found for ${requestUrl}`,
          404,
          requestUrl,
        );
      }
    } // if backend is erroring out
    else if (response.status >= 500) {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      sendErrorToParent(
        `Backend returned ${response.status} error for ${requestUrl}`,
        response.status,
        requestUrl,
      );
      return;
    }

    return response;
  } catch (error) {
    // network failures
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    sendErrorToParent(
      `Network error: Cannot connect to backend (${requestUrl})`,
      undefined,
      requestUrl,
    );
  }
};

export default fetchWrapper;
