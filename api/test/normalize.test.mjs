import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { normalizeMeliItem } = await import("../server.mjs");

test("normaliza uma oferta real do Mercado Livre sem inventar histórico", () => {
  const offer = normalizeMeliItem({
    id: "MLB123",
    title: "Smart TV Exemplo",
    price: 2800,
    original_price: 3500,
    permalink: "https://produto.mercadolivre.com.br/MLB-123",
    official_store_id: 99,
    official_store_name: "Loja Oficial",
    shipping: { free_shipping: true },
    attributes: [
      { id: "BRAND", value_name: "Marca" },
      { id: "MODEL", value_name: "Modelo X" },
      { id: "GTIN", value_name: "7890000000000" }
    ]
  });

  assert.equal(offer.id, "meli:MLB123");
  assert.equal(offer.discount, 20);
  assert.equal(offer.shipping, 0);
  assert.equal(offer.ean, "7890000000000");
  assert.equal(offer.historyReady, false);
  assert.equal(offer.status, "provavel");
});
