-- Rol de la aplicación: sin privilegios de dueño, sujeto a Row Level Security.
CREATE ROLE nuvamail LOGIN PASSWORD 'nuvamail' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO nuvamail;
