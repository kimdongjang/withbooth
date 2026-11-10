import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { dropLegacyProductColumns, legacyProductColumns } from '../scripts/dropLegacyProductColumns.mjs';

async function legacyDb(productCode = 'P001') {
  const db = new PGlite();
  await db.exec(`CREATE TABLE pos_products (project_id TEXT, id TEXT, name TEXT, price INTEGER, stock INTEGER, product_code TEXT, size TEXT,
    set_creator_name TEXT, set_group_name TEXT, set_price INTEGER, set_description TEXT, genre TEXT, PRIMARY KEY(project_id,id))`);
  await db.query(`INSERT INTO pos_products VALUES ('e','P001','키링',0,7,$1,'70x100','작가','세트',35000,NULL,'시리즈')`, [productCode]);
  return db;
}
const columns = async db => (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='pos_products'")).rows.map(r => r.column_name);

test('legacy product column drop rehearses by default, then drops only legacy columns and keeps rows', async () => {
  const db = await legacyDb();
  const rehearsal = await dropLegacyProductColumns(db);
  assert.equal(rehearsal.applied, false);
  assert.deepEqual(rehearsal.dropped.sort(), [...legacyProductColumns].sort());
  assert.ok((await columns(db)).includes('set_price'));
  const applied = await dropLegacyProductColumns(db, { apply: true });
  assert.equal(applied.rows, 1);
  assert.deepEqual((await columns(db)).sort(), ['genre', 'id', 'name', 'price', 'project_id', 'stock']);
  assert.deepEqual((await db.query('SELECT id,name,price,stock,genre FROM pos_products')).rows, [{ id: 'P001', name: '키링', price: 0, stock: 7, genre: '시리즈' }]);
  assert.deepEqual((await dropLegacyProductColumns(db, { apply: true })).dropped, []);
  await db.close();
});

test('legacy product column drop refuses a product_code that is not the id', async () => {
  const db = await legacyDb('OTHER');
  await assert.rejects(dropLegacyProductColumns(db, { apply: true }), { code: 'PRODUCT_CODE_DIFFERS_FROM_ID' });
  assert.ok((await columns(db)).includes('product_code'));
  await db.close();
});
