import {createClient} from '@vercel/postgres';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Administrative, explicit DB migration tooling; never exposed as a public API.
// 기본은 리허설이다: 한 트랜잭션에서 삭제·검증 후 ROLLBACK 한다. --apply일 때만 COMMIT 한다.
// 새 코드를 먼저 배포한 뒤 실행한다. 이전 코드의 initDb는 열을 다시 추가한다.
// product_code는 id의 별칭이고 size·set_*는 어떤 화면/API도 읽지 않는다.
export const legacyProductColumns=['product_code','size','set_creator_name','set_group_name','set_price','set_description'];
const fail=code=>{throw Object.assign(new Error(code),{code});};

export async function dropLegacyProductColumns(db,{apply=false}={}) {
 await db.query('BEGIN');
 let committed=false;
 try {
  // storageContract가 적용된 DB는 물리 이름이 pos_event_products다.
  const table=(await db.query("SELECT COALESCE(to_regclass('pos_event_products'),to_regclass('pos_products'))::text AS name")).rows[0]?.name;
  if(!table)fail('PRODUCTS_TABLE_REQUIRED');
  const present=(await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=ANY($2)',[table,legacyProductColumns])).rows.map(r=>r.column_name);
  const ident=name=>'"'+name.replace(/"/g,'""')+'"';
  const before=Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${ident(table)}`)).rows[0].n);
  // product_code가 id와 다른 행이 있으면 정렬·식별 정보가 사라지므로 중단한다.
  if(present.includes('product_code')&&Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${ident(table)} WHERE product_code IS NOT NULL AND product_code<>id`)).rows[0].n))fail('PRODUCT_CODE_DIFFERS_FROM_ID');
  const nonNull=present.length?(await db.query(`SELECT ${present.map(c=>`COUNT(${ident(c)})::int AS ${ident(c)}`).join(',')} FROM ${ident(table)}`)).rows[0]:{};
  if(present.length)await db.query(`ALTER TABLE ${ident(table)} ${present.map(c=>`DROP COLUMN ${ident(c)}`).join(', ')}`);
  const after=Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${ident(table)}`)).rows[0].n);
  if(after!==before)fail('ROW_COUNT_CHANGED');
  if(apply){await db.query('COMMIT');committed=true;} else await db.query('ROLLBACK');
  return {table,dropped:present,nonNullValues:nonNull,rows:after,applied:apply};
 } finally {
  if(!committed)await db.query('ROLLBACK').catch(()=>{});
 }
}

async function main() {
 const apply=process.argv.includes('--apply');
 // createClient는 Neon pooled 주소를 거절하므로 같은 브랜치의 direct 호스트로 바꾼다.
 const connectionString=process.env.DROP_LEGACY_DATABASE_URL?.replace(/(@[^/@]*?)-pooler\./,'$1.');
 if(!connectionString)fail('DROP_LEGACY_DATABASE_URL_REQUIRED');
 const db=createClient({connectionString});
 await db.connect();
 try { console.log(JSON.stringify(await dropLegacyProductColumns(db,{apply}))); }
 finally { await db.end(); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({code:/^[A-Za-z0-9_]{1,80}$/.test(error.code||'')?error.code:'DROP_LEGACY_COLUMNS_FAILED'}));process.exitCode=1;});
