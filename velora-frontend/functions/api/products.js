const fallbackProducts = [
  {
    id: 'demo-001',
    name: 'Demo Product',
    category: 'vuca',
    price: 1200,
    listed: true,
  },
  {
    id: 'demo-002',
    name: 'Studio Candle',
    category: 'saintmari',
    price: 1800,
    listed: true,
  },
]

export async function onRequestGet({ env }) {
  try {
    if (env?.DB) {
      try {
        const rows = await env.DB.prepare(
          'SELECT id, name_en AS name, category, price, listed FROM products ORDER BY id LIMIT 20'
        ).all()

        if (rows?.results?.length) {
          return Response.json({ ok: true, source: 'd1', items: rows.results })
        }
      } catch (error) {
        console.warn('D1 products query failed, using mock data:', error.message)
      }
    }

    return Response.json({ ok: true, source: 'mock', items: fallbackProducts })
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
