import { AddressInfo } from 'net';
import { IncomingHttpHeaders, Server, createServer } from 'http';

export interface RequisicaoRecebida {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface RespostaFake {
  status: number;
  body?: unknown;
}

/**
 * Servidor HTTP real em 127.0.0.1 (mock do OS Service): grava as requisicoes e
 * responde pela fila de respostas (vazia = `padrao`). Substitui o `nock`: nada
 * de interceptar o modulo `http` do processo, que tambem carrega o supertest e o
 * socket do Docker usado pelo testcontainers (causa do `write EPIPE` no CI).
 */
export class ServidorHttpFake {
  readonly recebidas: RequisicaoRecebida[] = [];
  private respostas: RespostaFake[] = [];
  private server?: Server;
  url = '';

  constructor(private readonly padrao: RespostaFake = { status: 200 }) {}

  responder(...respostas: RespostaFake[]): void {
    this.respostas.push(...respostas);
  }

  limpar(): void {
    this.recebidas.length = 0;
    this.respostas = [];
  }

  async iniciar(): Promise<void> {
    this.server = createServer((req, res) => {
      let dados = '';
      req.on('data', (c: Buffer) => (dados += c.toString()));
      req.on('end', () => {
        this.recebidas.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: dados ? JSON.parse(dados) : undefined,
        });
        const r = this.respostas.shift() ?? this.padrao;
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.body === undefined ? '' : JSON.stringify(r.body));
      });
    });
    await new Promise<void>((ok) => this.server!.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async parar(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}
