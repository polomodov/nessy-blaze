import type { FetchFunction } from "@ai-sdk/provider-utils";
import { request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const insecureHttpsAgent = new HttpsAgent({ rejectUnauthorized: false });

export function createSelfSignedFetch(): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const isHttps = url.protocol === "https:";
    const nodeRequest = isHttps ? httpsRequest : httpRequest;

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const bodyBuffer = request.body
      ? Buffer.from(await request.arrayBuffer())
      : undefined;

    return new Promise<Response>((resolve, reject) => {
      const req = nodeRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: request.method,
          headers,
          agent: isHttps ? insecureHttpsAgent : undefined,
          signal: request.signal,
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const entry of value) {
                responseHeaders.append(key, entry);
              }
            } else if (value != null) {
              responseHeaders.set(key, value);
            }
          }

          const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: responseHeaders,
            }),
          );
        },
      );

      req.on("error", reject);

      if (bodyBuffer) {
        req.write(bodyBuffer);
      }

      req.end();
    });
  };
}
