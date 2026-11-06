export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      response.status === 401 &&
      ![
        "/auth/login",
        "/auth/register",
        "/auth/guest",
        "/auth/session",
      ].includes(path)
    )
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      response.status,
      data?.error || "Something went wrong. Please try again.",
    );
  }
  if (data === null)
    throw new Error("Unexpected server response. Please try again.");
  return data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof TypeError
    ? "We couldn’t connect. Check your connection and try again."
    : error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";
