// Mock Tina CMS self-hosted backend endpoint for routing queries to local filesystem or repository
export const prerender = false;

export async function ALL({ request, locals }) {
  // TinaCMS CLI or server sends GraphQL queries here when using self-hosted modes.
  // In a full self-hosted implementation, this endpoint handles standard GraphQL queries
  // and routes file operations. We respond with dynamic JSON proxy.
  return new Response(JSON.stringify({
    data: {}
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
