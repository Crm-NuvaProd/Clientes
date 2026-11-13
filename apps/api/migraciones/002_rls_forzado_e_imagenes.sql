-- RLS también para el dueño de las tablas: así la app funciona igual con un solo usuario de base de datos
-- (Render, Railway…) o con un rol de app separado (AWS). Las únicas consultas entre empresas pasan por
-- funciones que activan app.sistema durante la consulta y lo apagan antes de devolver.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','contactos','listas','lista_contactos','activos','plantillas',
                           'campanas','envios','eventos'] LOOP
    EXECUTE format('DROP POLICY aislamiento ON %I', t);
    EXECUTE format('CREATE POLICY aislamiento ON %I USING (empresa_id = current_setting(''app.empresa_id'', true)::uuid '
                   'OR current_setting(''app.sistema'', true) = ''on'') '
                   'WITH CHECK (empresa_id = current_setting(''app.empresa_id'', true)::uuid '
                   'OR current_setting(''app.sistema'', true) = ''on'')', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP POLICY aislamiento ON empresas;
CREATE POLICY aislamiento ON empresas
  USING (id = current_setting('app.empresa_id', true)::uuid OR current_setting('app.sistema', true) = 'on')
  WITH CHECK (id = current_setting('app.empresa_id', true)::uuid OR current_setting('app.sistema', true) = 'on');
ALTER TABLE empresas FORCE ROW LEVEL SECURITY;

DROP FUNCTION login_buscar(text);
CREATE FUNCTION login_buscar(p_email text)
RETURNS TABLE (id uuid, empresa_id uuid, hash text, rol text, nombre text, activo boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.sistema', 'on', true);
  RETURN QUERY SELECT u.id, u.empresa_id, u.hash, u.rol, u.nombre, u.activo FROM usuarios u WHERE u.email = lower(p_email);
  PERFORM set_config('app.sistema', 'off', true);
END $$;

DROP FUNCTION campanas_pendientes();
CREATE FUNCTION campanas_pendientes()
RETURNS TABLE (id uuid, empresa_id uuid, estado text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.sistema', 'on', true);
  RETURN QUERY SELECT c.id, c.empresa_id, c.estado FROM campanas c
    WHERE c.estado IN ('enviando','prueba_ab') OR (c.estado = 'programada' AND c.programada_para <= now())
    ORDER BY c.iniciada NULLS FIRST, c.creado;
  PERFORM set_config('app.sistema', 'off', true);
END $$;

DROP FUNCTION envio_por_mensaje(text);
CREATE FUNCTION envio_por_mensaje(p_message_id text)
RETURNS TABLE (empresa_id uuid, campana_id uuid, contacto_id bigint, variante char(1))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.sistema', 'on', true);
  RETURN QUERY SELECT e.empresa_id, e.campana_id, e.contacto_id, e.variante FROM envios e WHERE e.message_id = p_message_id LIMIT 1;
  PERFORM set_config('app.sistema', 'off', true);
END $$;

-- Imágenes guardadas en la base cuando no hay S3 configurado (se sirven en /archivos/…)
ALTER TABLE activos ADD COLUMN datos bytea;

CREATE FUNCTION activo_publico(p_clave text)
RETURNS TABLE (mime text, datos bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.sistema', 'on', true);
  RETURN QUERY SELECT a.mime, a.datos FROM activos a WHERE a.clave = p_clave AND a.datos IS NOT NULL;
  PERFORM set_config('app.sistema', 'off', true);
END $$;

REVOKE ALL ON FUNCTION login_buscar(text), campanas_pendientes(), envio_por_mensaje(text), activo_publico(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nuvamail') THEN
    GRANT EXECUTE ON FUNCTION login_buscar(text), campanas_pendientes(), envio_por_mensaje(text), activo_publico(text) TO nuvamail;
  END IF;
END $$;
