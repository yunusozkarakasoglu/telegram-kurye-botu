export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "telegram-kurye-botu.packonexpress.workers.dev";
    const headers = new Headers(request.headers);
    headers.set("host", "telegram-kurye-botu.packonexpress.workers.dev");
    const init = {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    };
    return fetch(new Request(url.toString(), init));
  },
};
