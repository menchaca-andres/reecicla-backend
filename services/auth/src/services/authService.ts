import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomInt } from 'crypto';
import { UserModel } from '../models/userModel';
import { GuestVerificationModel } from '../models/guestVerificationModel';
import { EmailService } from './emailService';
import { RegisterDTO, CreateAdminDTO, LoginDTO, AuthPayload, UserResponse, UserRole } from '../types/auth';
import { publishEvent } from '../messaging/eventBus';

const SALT_ROUNDS = 10;

const ADMIN_ROLES: UserRole[] = ['TENANT_ADMIN', 'CATALOG_ADMIN', 'INSPECTOR'];

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET debe estar configurado.');
  return secret;
}

export class AuthService {
  static async register(dto: RegisterDTO): Promise<{ token: string; user: UserResponse }> {
    const existing = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existing) throw new Error('El usuario ya existe para este tenant.');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await UserModel.createUser({ ...dto, role: 'CLIENT' }, passwordHash);

    const token = AuthService.signToken(user.id, user.tenant_id, user.email, user.role as UserRole, user.name);
    const userResp = AuthService.toUserResponse(user);

    publishEvent('auth.user.registered', {
      event_type: 'user.registered',
      tenant_id: user.tenant_id,
      payload: {
        user_id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    }).catch((err) => console.error('Exception al publicar evento user.registered:', err));

    return { token, user: userResp };
  }

  static async createAdmin(dto: CreateAdminDTO): Promise<UserResponse> {
    const role: UserRole = dto.role ?? 'TENANT_ADMIN';

    if (!ADMIN_ROLES.includes(role)) {
      throw new Error(`Rol inválido. Roles permitidos: ${ADMIN_ROLES.join(', ')}.`);
    }

    const existing = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existing) throw new Error('El usuario ya existe para este tenant.');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await UserModel.createUser({ ...dto, role }, passwordHash);
    return AuthService.toUserResponse(user);
  }

  static async login(dto: LoginDTO): Promise<{ token: string; user: UserResponse }> {
    const user = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (!user) throw new Error('Credenciales inválidas o tenant incorrecto.');

    const isMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!isMatch) throw new Error('Credenciales inválidas o tenant incorrecto.');

    const token = AuthService.signToken(user.id, user.tenant_id, user.email, user.role as UserRole, user.name);
    return { token, user: AuthService.toUserResponse(user) };
  }

  static async getUserProfile(userId: string): Promise<UserResponse> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('Usuario no encontrado.');
    return AuthService.toUserResponse(user);
  }

  static async requestGuestVerification(dto: {
    tenant_id: string;
    quote_id: string;
    email: string;
    name: string;
    phone: string;
    address?: string;
  }): Promise<void> {
    const email = dto.email.trim();
    const name = dto.name.trim();
    const phone = dto.phone.trim();
    if (!dto.tenant_id || !dto.quote_id || !email || !name || !phone) {
      throw new Error('email, name, phone, quote_id y el contexto del negocio son requeridos.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('El correo del cliente no es válido.');
    }

    const code = randomInt(100000, 1000000).toString();
    const verification = await GuestVerificationModel.create({
      tenant_id: dto.tenant_id,
      quote_id: dto.quote_id,
      email,
      name,
      phone,
      address: dto.address?.trim() ?? '',
    }, code);
    try {
      await EmailService.sendGuestVerification(email, name, code);
    } catch (error) {
      await GuestVerificationModel.delete(verification.id);
      throw error;
    }
  }

  static async verifyGuestClient(dto: {
    tenant_id: string;
    quote_id: string;
    email: string;
    code: string;
  }): Promise<{ tenant_id: string; quote_id: string; email: string; name: string; phone: string; address: string }> {
    const tenantId = dto.tenant_id.trim();
    const quoteId = dto.quote_id.trim();
    const email = dto.email.trim();
    const code = dto.code.trim();
    if (!tenantId || !quoteId || !email || !/^\d{6}$/.test(code)) {
      throw new Error('El código de verificación y el contexto de la cotización son requeridos.');
    }

    const verified = await GuestVerificationModel.consume(tenantId, quoteId, email, code);
    if (!verified) throw new Error('El código de verificación es inválido o venció.');
    return verified;
  }

  private static signToken(userId: string, tenantId: string, email: string, role: UserRole, name?: string): string {
    const payload: AuthPayload = { userId, tenantId, email, name, role };
    return jwt.sign(payload, jwtSecret(), { expiresIn: '24h' });
  }

  private static toUserResponse(user: any): UserResponse {
    return {
      id: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      created_at: user.created_at,
    };
  }
}
