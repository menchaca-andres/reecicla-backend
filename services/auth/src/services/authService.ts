import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/userModel';
import { RegisterDTO, CreateAdminDTO, LoginDTO, AuthPayload, UserResponse, UserRole, CreateTenantDTO } from '../types/auth';
import { publishEvent } from '../messaging/eventBus';
import { TenantModel, TenantSummary } from '../models/tenantModel';

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_reecicla';
const SALT_ROUNDS = 10;
const ADMIN_ROLES: UserRole[] = ['TENANT_ADMIN', 'CATALOG_ADMIN', 'INSPECTOR'];
const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class AuthService {
  static async register(dto: RegisterDTO): Promise<{ token: string; user: UserResponse }> {
    const existing = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existing) throw new Error('El usuario ya existe para este tenant.');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await UserModel.createUser({ ...dto, role: 'CLIENT' }, passwordHash);
    const token = AuthService.signToken(user.id, user.tenant_id, user.email, user.role as UserRole, user.name);

    publishEvent('auth.user.registered', {
      event_type: 'user.registered',
      tenant_id: user.tenant_id,
      payload: { user_id: user.id, email: user.email, name: user.name, role: user.role },
    }).catch((err) => console.error('Exception al publicar evento user.registered:', err));

    return { token, user: AuthService.toUserResponse(user) };
  }

  static async createAdmin(dto: CreateAdminDTO): Promise<UserResponse> {
    const role: UserRole = dto.role ?? 'TENANT_ADMIN';
    if (!ADMIN_ROLES.includes(role)) {
      throw new Error(`Rol inválido. Roles permitidos: ${ADMIN_ROLES.join(', ')}.`);
    }
    if (dto.password.length < 8) {
      throw new Error('La contraseña debe tener al menos 8 caracteres.');
    }
    const existing = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existing) throw new Error('El usuario ya existe para este tenant.');
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await UserModel.createUser({ ...dto, role }, passwordHash);
    return AuthService.toUserResponse(user);
  }

  static async createTenantWithAdmin(dto: CreateTenantDTO): Promise<{ tenant: TenantSummary; admin: UserResponse }> {
    const name = dto.name.trim();
    const slug = dto.slug.trim().toLowerCase();
    if (!name || name.length > 255) throw new Error('El nombre del negocio debe tener entre 1 y 255 caracteres.');
    if (!TENANT_SLUG_PATTERN.test(slug) || slug.length > 60) {
      throw new Error('El slug solo puede contener letras minúsculas, números y guiones.');
    }
    if (!dto.email.trim() || !dto.password || dto.password.length < 8) {
      throw new Error('Se requiere correo y una contraseña de al menos 8 caracteres.');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    return TenantModel.createWithAdmin({ ...dto, name, slug }, passwordHash);
  }

  static async findActiveTenantBySlug(slug: string): Promise<TenantSummary | undefined> {
    return TenantModel.findActiveBySlug(slug);
  }

  static async listTenants(): Promise<TenantSummary[]> {
    return TenantModel.list();
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

  private static signToken(userId: string, tenantId: string, email: string, role: UserRole, name?: string): string {
    const payload: AuthPayload = { userId, tenantId, email, name, role };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
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
