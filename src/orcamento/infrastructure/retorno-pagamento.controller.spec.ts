import { RetornoPagamentoController, renderizarRetorno } from './retorno-pagamento.controller';

describe('RetornoPagamentoController (página de retorno do checkout)', () => {
  const controller = new RetornoPagamentoController();

  it.each([
    ['sucesso', 'Pagamento aprovado'],
    ['pendente', 'Pagamento em processamento'],
    ['falha', 'Pagamento não concluído'],
  ])('%s mostra "%s" e o número da OS', (resultado, titulo) => {
    const html = controller.pagina(resultado, 'OS-2026-0001');
    expect(html).toContain(titulo);
    expect(html).toContain('OS-2026-0001');
    expect(html).toContain('/ordens-servico/numero/OS-2026-0001/status');
  });

  it('resultado desconhecido vira "pendente" (nunca afirma aprovação)', () => {
    expect(renderizarRetorno('qualquer-coisa')).toContain('Pagamento em processamento');
  });

  it('ignora external_reference fora do formato (sem injeção de HTML)', () => {
    const html = renderizarRetorno('sucesso', '<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('Ordem de serviço');
  });

  it('sem número da OS não mostra o link de acompanhamento', () => {
    expect(renderizarRetorno('sucesso')).not.toContain('/ordens-servico/numero/');
  });
});
