export interface Credentials { id: string; password: string }
export interface CredentialProvider { getCredentials(): Promise<Credentials> }
export class EnvironmentCredentialProvider implements CredentialProvider {
  async getCredentials(): Promise<Credentials> {
    const { LEARNUS_ID: id, LEARNUS_PASSWORD: password } = process.env;
    if (!id || !password) throw new LearnUsError('CREDENTIALS_MISSING');
    return { id, password };
  }
}
import { LearnUsError } from '../errors.js';
