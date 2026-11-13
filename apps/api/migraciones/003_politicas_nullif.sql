-- En conexiones reutilizadas del pool, app.empresa_id vuelve a '' (no a NULL) al terminar una transacción:
-- se convierte con NULLIF para que la comparación dé "sin acceso" en vez de un error de tipo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','contactos','listas','lista_contactos','activos','plantillas',
                           'campanas','envios','eventos'] LOOP
    EXECUTE format('DROP POLICY aislamiento ON %I', t);
    EXECUTE format('CREATE POLICY aislamiento ON %I USING (empresa_id = NULLIF(current_setting(''app.empresa_id'', true), '''')::uuid '
                   'OR current_setting(''app.sistema'', true) = ''on'') '
                   'WITH CHECK (empresa_id = NULLIF(current_setting(''app.empresa_id'', true), '''')::uuid '
                   'OR current_setting(''app.sistema'', true) = ''on'')', t);
  END LOOP;
END $$;
DROP POLICY aislamiento ON empresas;
CREATE POLICY aislamiento ON empresas
  USING (id = NULLIF(current_setting('app.empresa_id', true), '')::uuid OR current_setting('app.sistema', true) = 'on')
  WITH CHECK (id = NULLIF(current_setting('app.empresa_id', true), '')::uuid OR current_setting('app.sistema', true) = 'on');
