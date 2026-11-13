import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { DbService } from '../comun/db.service.js';
import { COOKIE_SESION, limitar, Publico, Usuario, type Sesion } from '../comun/seguridad.js';
import { config } from '../config.js';

//COMMENTS

class LoginDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MinLength(8) @MaxLength(200) clave: string;
}

const HASH_FALSO = await argon2.hash(crypto.randomUUID(), { type: argon2.argon2id });

@Controller('auth')
export class AuthController {
  constructor(private db: DbService, private jwt: JwtService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    limitar(req, 'login', 10, 15 * 60_000);
    const [u] = await this.db.sistema('SELECT * FROM login_buscar($1)', [dto.email]);
    // Verifica siempre un hash para no revelar por tiempo de respuesta si el correo existe
    const ok = await argon2.verify(u?.hash ?? HASH_FALSO, dto.clave).catch(() => false);
    if (!u || !ok || !u.activo) throw new UnauthorizedException('Correo o clave incorrectos');
    const sesion: Sesion = { sub: u.id, empresaId: u.empresa_id, rol: u.rol, nombre: u.nombre };
    const token = await this.jwt.signAsync(sesion, { expiresIn: '8h' });
    res.cookie(COOKIE_SESION, token, {
      httpOnly: true, secure: config.produccion, sameSite: 'strict', maxAge: 8 * 3600_000, path: '/',
    });
    return { nombre: u.nombre, rol: u.rol };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_SESION, { path: '/' });
  }

  @Get('yo')
  async yo(@Usuario() s: Sesion) {
    const [e] = await this.db.tx(s.empresaId, async (c) => (await c.query('SELECT nombre FROM empresas')).rows);
    return { nombre: s.nombre, rol: s.rol, empresa: e?.nombre ?? '' };
  }
}
