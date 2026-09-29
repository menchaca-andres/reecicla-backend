import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/userModel';
import { RegisterDTO, CreateAdminDTO, LoginDTO, AuthPayload, UserResponse } from '../types/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_reecicla';

export class AuthService {
  // Public client registration: Always forces role = 'CLIENT'
  static async register(dto: RegisterDTO): Promise<{ token: string; user: UserResponse }> {
    const existingUser = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existingUser) {
      throw new Error('El usuario ya existe para este tenant.');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = await UserModel.createUser({ ...dto, role: 'CLIENT' }, passwordHash);

    const payload: AuthPayload = {
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    return {
      token,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        created_at: user.created_at,
      },
    };
  }

  // Superadmin endpoint: Create an ADMIN user for a specific tenant
  static async createAdmin(dto: CreateAdminDTO): Promise<UserResponse> {
    const existingUser = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (existingUser) {
      throw new Error('El administrador ya existe para este tenant.');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = await UserModel.createUser({ ...dto, role: 'ADMIN' }, passwordHash);

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

  static async login(dto: LoginDTO): Promise<{ token: string; user: UserResponse }> {
    const user = await UserModel.findByEmailAndTenant(dto.email, dto.tenant_id);
    if (!user) {
      throw new Error('Credenciales inválidas o tenant incorrecto.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!isMatch) {
      throw new Error('Credenciales inválidas o tenant incorrecto.');
    }

    const payload: AuthPayload = {
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    return {
      token,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        created_at: user.created_at,
      },
    };
  }

  static async getUserProfile(userId: string): Promise<UserResponse> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error('Usuario no encontrado.');
    }
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
