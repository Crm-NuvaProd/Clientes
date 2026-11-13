import { Routes } from '@angular/router';
import { conSesion } from './core/api';
import { Shell } from './shell/shell';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./paginas/login/login').then((m) => m.Login), title: 'Entrar · NuvaMail' },
  {
    path: '', component: Shell, canActivate: [conSesion],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'panel' },
      { path: 'panel', loadComponent: () => import('./paginas/panel/panel').then((m) => m.PanelPagina), title: 'Panel · NuvaMail' },
      { path: 'campanas', loadComponent: () => import('./paginas/campanas/campanas').then((m) => m.CampanasPagina), title: 'Campañas · NuvaMail' },
      { path: 'campanas/nueva', loadComponent: () => import('./paginas/campana-form/campana-form').then((m) => m.CampanaForm), title: 'Nueva campaña · NuvaMail' },
      { path: 'campanas/:id/editar', loadComponent: () => import('./paginas/campana-form/campana-form').then((m) => m.CampanaForm), title: 'Campaña · NuvaMail' },
      { path: 'campanas/:id/reporte', loadComponent: () => import('./paginas/reporte/reporte').then((m) => m.Reporte), title: 'Reporte · NuvaMail' },
      { path: 'plantillas', loadComponent: () => import('./paginas/plantillas/plantillas').then((m) => m.PlantillasPagina), title: 'Diseños · NuvaMail' },
      { path: 'plantillas/:id', loadComponent: () => import('./paginas/editor/editor').then((m) => m.Editor), title: 'Editor · NuvaMail' },
      { path: 'contactos', loadComponent: () => import('./paginas/contactos/contactos').then((m) => m.ContactosPagina), title: 'Contactos · NuvaMail' },
      { path: 'entregabilidad', loadComponent: () => import('./paginas/entregabilidad/entregabilidad').then((m) => m.EntregabilidadPagina), title: 'Entregabilidad · NuvaMail' },
      { path: 'configuracion', loadComponent: () => import('./paginas/configuracion/configuracion').then((m) => m.ConfiguracionPagina), title: 'Configuración · NuvaMail' },
    ],
  },
  { path: '**', redirectTo: '' },
];
