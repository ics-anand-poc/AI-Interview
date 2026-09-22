export type HttpErrorInfo = {
  code: number;
  title: string;
  description: string;
};

const HTTP_ERRORS: Record<number, Omit<HttpErrorInfo, "code">> = {
  400: {
    title: "Bad request",
    description: "That request could not be understood. Check the page or try again from Home.",
  },
  401: {
    title: "Sign in required",
    description: "You need to sign in before you can open this page.",
  },
  402: {
    title: "Payment required",
    description: "This action is not available on the current plan.",
  },
  403: {
    title: "Access denied",
    description: "You do not have permission to view this page.",
  },
  404: {
    title: "Page not found",
    description: "This URL is missing or was moved. Use Home or the Screening Console to continue.",
  },
  405: {
    title: "Method not allowed",
    description: "This page does not accept that kind of request.",
  },
  406: {
    title: "Not acceptable",
    description: "The app cannot return a response in the format that was requested.",
  },
  407: {
    title: "Proxy authentication required",
    description: "A proxy must authenticate this request before it can continue.",
  },
  408: {
    title: "Request timed out",
    description: "The request took too long. Try again in a moment.",
  },
  409: {
    title: "Conflict",
    description: "This change conflicts with the current data. Refresh and try again.",
  },
  410: {
    title: "Gone",
    description: "This page has been removed and is no longer available.",
  },
  411: {
    title: "Length required",
    description: "This request is missing a required length header.",
  },
  412: {
    title: "Precondition failed",
    description: "A condition for this request was not met. Refresh and retry.",
  },
  413: {
    title: "File too large",
    description: "The upload is larger than TalentScope allows. Use a smaller file.",
  },
  414: {
    title: "URI too long",
    description: "This address is too long to process. Open the page from a shorter link.",
  },
  415: {
    title: "Unsupported file type",
    description: "That format is not supported. Use PDF, DOCX, or the file type this screen accepts.",
  },
  416: {
    title: "Range not satisfiable",
    description: "The requested file range is not available.",
  },
  417: {
    title: "Expectation failed",
    description: "The server could not meet the expectation set by this request.",
  },
  418: {
    title: "I'm a teapot",
    description: "This endpoint refuses to brew coffee. Try a different page.",
  },
  421: {
    title: "Misdirected request",
    description: "This request was sent to a server that cannot produce a response.",
  },
  422: {
    title: "Unprocessable request",
    description: "The data was understood but could not be processed. Check the form and retry.",
  },
  423: {
    title: "Locked",
    description: "This resource is locked and cannot be changed right now.",
  },
  424: {
    title: "Failed dependency",
    description: "This step failed because an earlier step did not succeed.",
  },
  425: {
    title: "Too early",
    description: "The server is unwilling to process this request yet. Wait and retry.",
  },
  426: {
    title: "Upgrade required",
    description: "This connection must be upgraded before it can continue.",
  },
  428: {
    title: "Precondition required",
    description: "This change needs a fresh copy of the data. Refresh the page first.",
  },
  429: {
    title: "Too many requests",
    description: "You have made too many requests. Wait a short while, then try again.",
  },
  431: {
    title: "Headers too large",
    description: "The request headers are too large to process.",
  },
  451: {
    title: "Unavailable for legal reasons",
    description: "This content cannot be shown for legal reasons.",
  },
  500: {
    title: "Something went wrong",
    description: "TalentScope hit an unexpected error. Try again, or return Home.",
  },
  501: {
    title: "Not implemented",
    description: "This action is not supported yet.",
  },
  502: {
    title: "Bad gateway",
    description: "An upstream service returned an invalid response. Try again shortly.",
  },
  503: {
    title: "Service unavailable",
    description: "TalentScope is temporarily unavailable. Please try again in a few minutes.",
  },
  504: {
    title: "Gateway timeout",
    description: "A connected service took too long to reply. Retry in a moment.",
  },
  505: {
    title: "HTTP version not supported",
    description: "This HTTP version is not supported.",
  },
  506: {
    title: "Variant also negotiates",
    description: "The server has an internal configuration error for this request.",
  },
  507: {
    title: "Insufficient storage",
    description: "There is not enough storage to complete this request.",
  },
  508: {
    title: "Loop detected",
    description: "The server stopped this request after detecting a processing loop.",
  },
  510: {
    title: "Not extended",
    description: "The request needs further extensions to be fulfilled.",
  },
  511: {
    title: "Network authentication required",
    description: "You must authenticate with the network before accessing TalentScope.",
  },
};

export const HTTP_ERROR_CODES = Object.keys(HTTP_ERRORS).map((code) => Number(code));

export function parseHttpErrorCode(value: string | number | undefined): number {
  const code = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(code) || code < 400 || code > 599) return 404;
  return code;
}

export function getHttpError(code: number): HttpErrorInfo {
  const normalized = parseHttpErrorCode(code);
  const known = HTTP_ERRORS[normalized];
  if (known) return { code: normalized, ...known };
  if (normalized >= 500) {
    return {
      code: normalized,
      title: "Server error",
      description: "The server could not complete this request. Try again in a moment.",
    };
  }
  return {
    code: normalized,
    title: "Request error",
    description: "This request could not be completed. Return Home or try another page.",
  };
}
