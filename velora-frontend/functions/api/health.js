export async function onRequestGet({ env }) {
  try {
    if (env?.DB) {
      const row = await env.DB.prepare('SELECT 1 AS ok').first()
      if (row?.ok === 1) {
        return Response.json({
          ok: true,
          source: 'd1',
          message: 'Cloudflare D1 connected',
        })
      }
    }

    return Response.json({
      ok: true,
      source: 'mock',
      message: 'Cloudflare Pages ready. Bind a D1 database to use real data.',
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source: 'error',
        message: error.message,
      },
      { status: 500 }
    )
  }
}
