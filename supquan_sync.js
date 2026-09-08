require("dotenv").config({ path: path.join(__dirname, ".env") });

const { createClient } = require("@supabase/supabase-js");
const sql = require("mssql");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const dbConfig = {
  user: process.env.OLD_DB_USER,
  password: process.env.OLD_DB_PASSWORD,
  server: process.env.OLD_DB_HOST,
  database: process.env.OLD_DB_DATABASE,
  port: parseInt(process.env.OLD_DB_PORT || "1433"),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

async function syncData() {
  const startTime = Date.now();

  try {
    await sql.connect(dbConfig);

    const result = await sql.query`
      select x.*, e.emp_name, o12.sheet_date as date_min, o1.sheet_Date as date_max
      from (
          select
              supplier, x.rem, mat_type, cast(goods_type as varchar(30)) goods_type, count(po_no) as po_num, sum(return_mat) as return_mat,
              sum(late_ship) as late_ship, concat( 'Supplier: ' + supplier, ' - Type: ' + goods_type) goods_type_code, min(po_no) as po_min, max(po_no) as po_max
          from (
              select
                  cast(concat(s.su_no, concat(' - ', isnull(s.su_name1, s.su_name))) as varchar(500)) as supplier, 
                  o.sheet_no as po_no, o.sheet_id as po_id,
                  concat('addr: ', concat(s.su_addr, concat(' Payment Term: ', c.pay_con_desc))) as rem,
                  left(g.goods_no, 2) as mat_type, 
                  case when left(g.goods_no, 2) = 'M1' then concat(g.goods_type, concat(' - ', t.goods_type_desc)) else '' end as goods_type, 
                  case when left(g.goods_no, 2) = 'M1' then g.goods_type else null end as goods_type_code,
                  o.su_del_date, n.sheet_date as notice_date, case when n.return_qty > 0 then 1 else 0 end as return_mat, 
                  case when datediff(day, isnull(n.sheet_date, getdate()), isnull(o.su_del_date, n.sheet_date)) < 0 then 1 else 0 end as late_ship
              from bas_supply s
              inner join bas_pay_con c with(nolock) on c.pay_con = s.pay_con
              inner join v_pur_order_detail o with(nolock) on o.su_no1 = s.su_no 
              inner join bas_goods g with(nolock) on g.goods_no = o.goods_no
              left join bas_goods_type t with(nolock) on t.goods_type = g.goods_type 
              left join v_pur_notice_detail n with(nolock) on n.pur_no = o.sheet_no and n.pur_id = o.sheet_id 
              where left(o.goods_no, 2) in ('M1', 'M2', 'M3') and o.sheet_date >= dateadd(day, -365, cast(getdate() as date))
          ) x
          group by supplier, x.rem, mat_type, goods_type, goods_type_code
      ) x
      left join pur_order1 o1 with(nolock) on o1.sheet_no = x.po_max
      left join bas_emp e with(nolock) on e.emp_no = o1.create_user
      left join pur_order1 o12 with(nolock) on o12.sheet_no = x.po_min
    `;

    const data = result.recordset;

    if (data.length === 0) {
      return;
    }

    const { error: truncateError } = await supabase.rpc('truncate_supplier_data');

    if (truncateError) {
      // Fallback: if TRUNCATE error, use DELETE
      const { error: deleteError } = await supabase
        .from('supplier_data')
        .delete()
        .neq('id', 0);
            
      if (deleteError) {
        return;
      }
    }

    const batchSize = 500;
    const totalBatches = Math.ceil(data.length / batchSize);
    console.log(`Synchronizing ${data.length} records (${totalBatches} batches)...`);

    let successCount = 0;
    const batchId = `BATCH_${Date.now()}`;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      const dataWithMeta = batch.map(row => ({
        ...row,
        sync_batch: batchId,
        updated_at: new Date()
      }));

      const { error: insertError } = await supabase
        .from('supplier_data')
        .insert(dataWithMeta);

      if (insertError) {
        console.error(`Batch error: ${batchNum}/${totalBatches}:`, insertError.message);
        continue;
      }

      successCount += batch.length;
      console.log(`✅ Batch ${batchNum}/${totalBatches} success (${batch.length} records)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`Sync ${successCount}/${data.length} records. ⏱️ Time: ${duration} seconds`);
  } catch (error) {
    console.error("ERROR:", error.message);

    if (error.originalError) {
      console.error("DETAIL ERROR:", error.originalError.message);
    }
  } finally {
    await sql.close();
  }
}

syncData();
