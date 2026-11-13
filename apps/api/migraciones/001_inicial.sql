-- NuvaMail · esquema inicial
-- Se ejecuta con el rol dueño (DATABASE_ADMIN_URL). La app se conecta con un rol sin privilegios
-- (nuvamail) sujeto a Row Level Security: cada consulta solo ve filas de app.empresa_id.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE empresas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  dominio_envio   text NOT NULL DEFAULT '',
  from_email      text NOT NULL DEFAULT '',
  from_nombre     text NOT NULL DEFAULT '',
  reply_to        text NOT NULL DEFAULT '',
  pie_legal       text NOT NULL DEFAULT '',
  url_politica    text NOT NULL DEFAULT '',
  direccion       text NOT NULL DEFAULT '',
  warmup_inicio   date,
  warmup_plan     int[] NOT NULL DEFAULT '{500,1000,2000,3500,5000,7500,10000}',
  tope_diario     int NOT NULL DEFAULT 10000,
  ritmo_seg       numeric(6,2) NOT NULL DEFAULT 8,
  tope_dominio_min int NOT NULL DEFAULT 60,      -- máx. correos por minuto a un mismo dominio
  max_rebote      numeric(6,4) NOT NULL DEFAULT 0.04,
  max_queja       numeric(6,4) NOT NULL DEFAULT 0.001,
  creado          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  email       text NOT NULL UNIQUE,
  nombre      text NOT NULL DEFAULT '',
  hash        text NOT NULL,
  rol         text NOT NULL CHECK (rol IN ('admin','editor','analista')),
  activo      boolean NOT NULL DEFAULT true,
  creado      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_usuarios_empresa ON usuarios(empresa_id);

CREATE TABLE contactos (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  email                 text NOT NULL CHECK (email = lower(email)),
  nombre                text NOT NULL DEFAULT '',
  compania              text NOT NULL DEFAULT '',
  ciudad                text NOT NULL DEFAULT '',
  cargo                 text NOT NULL DEFAULT '',
  atributos             jsonb NOT NULL DEFAULT '{}',
  estado                text NOT NULL DEFAULT 'activo'
                         CHECK (estado IN ('activo','baja','rebote','queja','invalido')),
  estado_motivo         text NOT NULL DEFAULT '',
  origen_consentimiento text NOT NULL DEFAULT '',
  fecha_consentimiento  date,
  envios                int NOT NULL DEFAULT 0,
  aperturas             int NOT NULL DEFAULT 0,
  clics                 int NOT NULL DEFAULT 0,
  rebotes_suaves_seguidos int NOT NULL DEFAULT 0,
  ultimo_envio          timestamptz,
  ultima_interaccion    timestamptz,
  creado                timestamptz NOT NULL DEFAULT now(),
  actualizado           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, email)
);
CREATE INDEX ix_contactos_estado ON contactos(empresa_id, estado);
CREATE INDEX ix_contactos_interaccion ON contactos(empresa_id, ultima_interaccion DESC NULLS LAST);

CREATE TABLE listas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nombre      text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  creado      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);

CREATE TABLE lista_contactos (
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  lista_id    uuid NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
  contacto_id bigint NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  PRIMARY KEY (lista_id, contacto_id)
);
CREATE INDEX ix_lista_contactos_contacto ON lista_contactos(empresa_id, contacto_id);

CREATE TABLE activos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nombre      text NOT NULL,
  mime        text NOT NULL,
  tamano      int NOT NULL,
  clave       text NOT NULL,
  url         text NOT NULL,
  creado      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_activos_empresa ON activos(empresa_id, creado DESC);

CREATE TABLE plantillas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nombre      text NOT NULL,
  origen      text NOT NULL DEFAULT 'editor' CHECK (origen IN ('editor','claude','html')),
  diseno      jsonb NOT NULL,
  html        text NOT NULL DEFAULT '',
  creado      timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_plantillas_empresa ON plantillas(empresa_id, actualizado DESC);

CREATE TABLE campanas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  nombre             text NOT NULL,
  asunto             text NOT NULL DEFAULT '',
  asunto_b           text NOT NULL DEFAULT '',          -- prueba A/B del asunto
  ab_porcentaje      int NOT NULL DEFAULT 0 CHECK (ab_porcentaje BETWEEN 0 AND 50),
  ab_horas           int NOT NULL DEFAULT 4,
  ab_criterio        text NOT NULL DEFAULT 'aperturas' CHECK (ab_criterio IN ('aperturas','clics')),
  ab_ganador         char(1),
  preencabezado      text NOT NULL DEFAULT '',
  plantilla_id       uuid REFERENCES plantillas(id),
  html               text NOT NULL DEFAULT '',          -- copia congelada al iniciar el envío
  lista_ids          uuid[] NOT NULL DEFAULT '{}',
  excluir_inactivos_dias int NOT NULL DEFAULT 0,       -- política de inactividad (sunset)
  estado             text NOT NULL DEFAULT 'borrador'
                      CHECK (estado IN ('borrador','programada','prueba_ab','enviando','pausada','terminada')),
  motivo_pausa       text NOT NULL DEFAULT '',
  programada_para    timestamptz,
  iniciada           timestamptz,
  terminada          timestamptz,
  creado             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_campanas_empresa ON campanas(empresa_id, creado DESC);
CREATE INDEX ix_campanas_estado ON campanas(estado) WHERE estado IN ('programada','prueba_ab','enviando');

CREATE TABLE envios (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id   uuid NOT NULL REFERENCES empresas(id),
  campana_id   uuid NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  contacto_id  bigint NOT NULL REFERENCES contactos(id),
  variante     char(1) NOT NULL DEFAULT 'A',
  orden        int NOT NULL DEFAULT 0,                 -- prioridad: más comprometidos primero
  estado       text NOT NULL DEFAULT 'cola' CHECK (estado IN ('cola','espera_ab','enviado','fallido','omitido')),
  dominio      text NOT NULL DEFAULT '',
  message_id   text,
  error        text,
  intentos     int NOT NULL DEFAULT 0,
  enviado_en   timestamptz,
  UNIQUE (campana_id, contacto_id)
);
CREATE INDEX ix_envios_cola ON envios(campana_id, estado, orden, id);
CREATE INDEX ix_envios_dia ON envios(empresa_id, enviado_en) WHERE estado = 'enviado';
CREATE INDEX ix_envios_dominio ON envios(empresa_id, dominio, enviado_en);
CREATE INDEX ix_envios_msg ON envios(message_id);

CREATE TABLE eventos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id   uuid NOT NULL REFERENCES empresas(id),
  campana_id   uuid REFERENCES campanas(id) ON DELETE CASCADE,
  contacto_id  bigint REFERENCES contactos(id),
  variante     char(1),
  tipo         text NOT NULL CHECK (tipo IN ('entregado','rebote_duro','rebote_suave','queja','apertura',
                                              'clic','baja','rechazado','retraso')),
  detalle      text NOT NULL DEFAULT '',
  url          text NOT NULL DEFAULT '',
  dominio      text NOT NULL DEFAULT '',
  dispositivo  text NOT NULL DEFAULT '',
  cliente      text NOT NULL DEFAULT '',
  es_mpp       boolean NOT NULL DEFAULT false,         -- apertura automática de Apple Mail Privacy Protection
  creado       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_eventos_campana ON eventos(empresa_id, campana_id, tipo);
CREATE INDEX ix_eventos_tiempo ON eventos(empresa_id, campana_id, creado);

-- ---------- Row Level Security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','contactos','listas','lista_contactos','activos','plantillas',
                           'campanas','envios','eventos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento ON %I USING (empresa_id = current_setting(''app.empresa_id'', true)::uuid) '
                   'WITH CHECK (empresa_id = current_setting(''app.empresa_id'', true)::uuid)', t);
  END LOOP;
END $$;
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento ON empresas USING (id = current_setting('app.empresa_id', true)::uuid);

-- Funciones con privilegio del dueño para los únicos accesos entre empresas permitidos
CREATE FUNCTION login_buscar(p_email text)
RETURNS TABLE (id uuid, empresa_id uuid, hash text, rol text, nombre text, activo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, empresa_id, hash, rol, nombre, activo FROM usuarios WHERE email = lower(p_email) $$;

CREATE FUNCTION campanas_pendientes()
RETURNS TABLE (id uuid, empresa_id uuid, estado text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, empresa_id, estado FROM campanas
   WHERE estado IN ('enviando','prueba_ab') OR (estado = 'programada' AND programada_para <= now())
   ORDER BY iniciada NULLS FIRST, creado $$;

CREATE FUNCTION envio_por_mensaje(p_message_id text)
RETURNS TABLE (empresa_id uuid, campana_id uuid, contacto_id bigint, variante char(1))
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT empresa_id, campana_id, contacto_id, variante FROM envios WHERE message_id = p_message_id LIMIT 1 $$;

REVOKE ALL ON FUNCTION login_buscar(text), campanas_pendientes(), envio_por_mensaje(text) FROM PUBLIC;

-- Rol de app separado (AWS / Docker). En plataformas con un solo usuario (Render) se omite.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nuvamail') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nuvamail;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO nuvamail;
    GRANT EXECUTE ON FUNCTION login_buscar(text), campanas_pendientes(), envio_por_mensaje(text) TO nuvamail;
  END IF;
END $$;
