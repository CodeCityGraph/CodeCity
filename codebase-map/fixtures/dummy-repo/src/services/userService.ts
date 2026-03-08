import { queryUser } from "../infra/db";
import type { User } from "../models/user";

export async function getUserById(id: string): Promise<User> {
  const row = await queryUser(id);
  return {
    id: row.id,
    name: row.name,
    email: row.email
  };
}
