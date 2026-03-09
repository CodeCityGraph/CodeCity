import { queryPasswordHash } from "../infra/db";
import { hashPassword } from "../utils/hash";

export async function authenticate(id: string, input: string): Promise<boolean> {
  const stored = await queryPasswordHash(id);
  return stored === hashPassword(input);
}
