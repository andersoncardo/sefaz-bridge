/** Chaves lógicas começam com `sefaz/{companyId}/{tpAmb}/{cnpj}/...` (sem bucket). */
export interface ISefazBlobStore {
  putUtf8(key: string, content: string): Promise<void>;
  getUtf8(key: string): Promise<string | null>;
  putBuffer(key: string, body: Buffer, contentType?: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** Retorna chaves lógicas completas sob o prefixo (inclusive subpastas). */
  listKeys(prefix: string): Promise<string[]>;
}
