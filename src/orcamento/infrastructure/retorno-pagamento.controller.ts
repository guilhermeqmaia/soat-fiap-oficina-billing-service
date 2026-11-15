import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@guilhermeqmaia/oficina-kit/auth';

/** Resultado do checkout informado pelo Mercado Pago na URL de retorno. */
export type ResultadoCheckout = 'sucesso' | 'falha' | 'pendente';

const TEXTOS: Record<ResultadoCheckout, { titulo: string; mensagem: string; cor: string }> = {
  sucesso: {
    titulo: 'Pagamento aprovado',
    mensagem:
      'Recebemos o seu pagamento. A oficina já foi avisada e o veículo fica pronto para retirada.',
    cor: '#237804',
  },
  pendente: {
    titulo: 'Pagamento em processamento',
    mensagem:
      'O Mercado Pago ainda está processando o pagamento. Avisaremos assim que ele for confirmado.',
    cor: '#ad6800',
  },
  falha: {
    titulo: 'Pagamento não concluído',
    mensagem:
      'O pagamento não foi aprovado. Você pode tentar de novo pelo mesmo link de pagamento.',
    cor: '#a8071a',
  },
};

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Número de OS no formato do OS Service; qualquer outra coisa é ignorada. */
const numeroValido = (n?: string) => (n && /^[A-Za-z0-9-]{1,40}$/.test(n) ? n : undefined);

/**
 * Página de retorno do checkout do Mercado Pago (`MP_RETORNO_BASE_URL` + `/sucesso`,
 * `/falha`, `/pendente`). É só informativa: quem confirma o pagamento é o webhook +
 * a consulta da order, nunca esta página (os parâmetros da URL vêm do navegador).
 * Pública no gateway (`GET /pagamento/{resultado}`); fora do OpenAPI por não ser API.
 */
@ApiExcludeController()
@Controller('pagamento')
export class RetornoPagamentoController {
  @Public()
  @Get(':resultado')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  pagina(
    @Param('resultado') resultado: string,
    @Query('external_reference') externalReference?: string,
  ): string {
    return renderizarRetorno(resultado, externalReference);
  }
}

export function renderizarRetorno(resultado: string, externalReference?: string): string {
  const chave: ResultadoCheckout =
    resultado in TEXTOS ? (resultado as ResultadoCheckout) : 'pendente';
  const { titulo, mensagem, cor } = TEXTOS[chave];
  const numero = numeroValido(externalReference);
  const os = numero
    ? `<p class="os">Ordem de serviço <strong>${escapar(numero)}</strong></p>
       <p><a href="/ordens-servico/numero/${encodeURIComponent(numero)}/status">Acompanhar o status da OS</a></p>`
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · Oficina Mecânica</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;color:#1f1f1f;display:flex;min-height:100vh;align-items:center;justify-content:center}
  main{background:#fff;border-radius:12px;padding:40px 48px;max-width:520px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
  h1{color:${cor};font-size:28px;margin:0 0 16px}
  p{font-size:17px;line-height:1.5;margin:8px 0}
  .os{margin-top:20px;color:#434343}
  a{color:#1677ff}
  footer{margin-top:28px;font-size:13px;color:#8c8c8c}
</style>
</head>
<body><main>
  <h1>${titulo}</h1>
  <p>${mensagem}</p>
  ${os}
  <footer>Oficina Mecânica · pagamento processado pelo Mercado Pago</footer>
</main></body>
</html>`;
}
