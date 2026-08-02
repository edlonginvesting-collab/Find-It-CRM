// Public-site deployment entrypoint. The authenticated CRM API remains a separate
// Node service; the published company site is served by the platform asset binding.
export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (request: Request) => Promise<Response> } }) {
    return env.ASSETS.fetch(request);
  }
};
