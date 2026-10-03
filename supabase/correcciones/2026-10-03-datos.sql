-- Correcciones de datos del catálogo (2026-10-03). Se pega entera en Supabase → SQL Editor y se ejecuta una sola vez.
-- Es seguro repetirla: la segunda vez no cambia nada. No es una migración (no vive en supabase/migrations).

-- 1) La bolsa jumbo tenía por nombre "0265", que es el código de la bolsa normal. Se le pone su nombre real.
--    Su código sigue siendo el texto "BOLSA BASURA JUMBO X UNIDAD" (un código no se puede cambiar una vez creado).
update public.products
set data = jsonb_set(data, '{name}', '"BOLSA BASURA JUMBO X UNIDAD"')
where code = 'BOLSA BASURA JUMBO X UNIDAD' and data->>'name' = '0265';

-- ...y la venta 2, que guardó ese mismo nombre en su línea.
update public.sales
set data = jsonb_set(data, '{items}', (
  select jsonb_agg(case when it->>'code' = 'BOLSA BASURA JUMBO X UNIDAD' and it->>'name' = '0265'
                        then jsonb_set(it, '{name}', '"BOLSA BASURA JUMBO X UNIDAD"')
                        else it end)
  from jsonb_array_elements(data->'items') it))
where id = 2 and jsonb_path_exists(data, '$.items[*] ? (@.name == "0265")');

-- 2) Nombres: espacios dobles o sobrantes (32 productos) y 4 erratas de letra O escrita en vez de cero.
with fixed as (
  select code,
         regexp_replace(btrim(case code
           when '0032'          then replace(data->>'name', '15O', '150')
           when '0422'          then replace(data->>'name', '1.5O', '1.50')
           when '7450077031644' then replace(data->>'name', 'ECON0MICO', 'ECONOMICO')
           when '7707292831512' then replace(data->>'name', ' 2O ', ' 20 ')
           else data->>'name' end), '\s{2,}', ' ', 'g') as nuevo
  from public.products)
update public.products p
set data = jsonb_set(p.data, '{name}', to_jsonb(f.nuevo))
from fixed f
where f.code = p.code and f.nuevo is distinct from p.data->>'name';

-- 3) Unidad de venta: 40 productos que se venden por metro y 2 por kilo. Hoy todos dicen "unidad", por eso la
--    calculadora de peso/medida de Venta nunca se abre. Quedan como "unidad" PRECORTE, FALTANTES y BOLSA TRANSPARENTE
--    PURINERA (tienen decimales pero no se sabe en qué se miden). Para deshacerlo: poner "unidad" otra vez.
update public.products
set data = jsonb_set(data, '{unit}', case when code in ('0156', '0558') then '"kg"'::jsonb else '"m"'::jsonb end)
where data->>'unit' = 'unidad'
  and code in ('0156', '0558',
               '0221', '0165', '0158', '0268', '0565', '0226', '0227', '0571', '0210', '0526', '0209', '0224', '0225',
               '0340', '0159', '0710', '0315', '0572', '0312', '0405', '0380', '0722', '0525', '0381', '0382', '0140',
               '0137', '0139', '0529', '001', '0133', '0136', '0131', '0135', '0132', '0144', '0145', '0146', '0147', '0148');

-- Resultado esperado: unidad 962 · m 40 · kg 2.
select data->>'unit' as unidad, count(*)::int as productos from public.products group by 1 order by 2 desc;
