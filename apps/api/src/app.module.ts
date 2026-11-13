import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivosController, AlmacenService } from './activos/activos.js';
import { AuthController } from './auth/auth.controller.js';
import { CampanasController } from './campanas/campanas.controller.js';
import { DbService } from './comun/db.service.js';
import { ProblemaFilter } from './comun/problema.filter.js';
import { AuthGuard } from './comun/seguridad.js';
import { config } from './config.js';
import { ContactosController } from './contactos/contactos.controller.js';
import { EmpresaController } from './empresa/empresa.controller.js';
import { CorreoService } from './envio/correo.service.js';
import { EventosService } from './envio/eventos.service.js';
import { TrabajadorService } from './envio/trabajador.service.js';
import { EstadisticasController } from './estadisticas/estadisticas.controller.js';
import { PlantillasController } from './plantillas/plantillas.controller.js';
import { PublicoController } from './publico/publico.controller.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: config.jwtSecreto, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
  ],
  controllers: [
    AuthController, ContactosController, PlantillasController, ActivosController, CampanasController,
    EstadisticasController, EmpresaController, PublicoController,
  ],
  providers: [
    DbService, AlmacenService, CorreoService, EventosService, TrabajadorService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemaFilter },
  ],
})
export class AppModule {}
