/**
 * Cloudflare Pages Function that proxies /api/routes requests
 * to the campfire-routes-proxy Worker via a Service Binding.
 *
 * This avoids 405 errors when the frontend POSTs to /api/routes
 * on the Pages domain — without this, Pages tries to serve it as
 * a static file and rejects the POST method.
 */

interface Environment {
  ROUTES_PROXY: Fetcher;
}

export const onRequest: PagesFunction<Environment> = async (context) => {
  return context.env.ROUTES_PROXY.fetch(context.request);
};
