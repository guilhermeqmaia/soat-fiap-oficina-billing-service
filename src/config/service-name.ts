/** Nome deste servico em logs (`service`), metricas (label `service`) e APM. */
export const SERVICE_NAME = process.env.DD_SERVICE ?? 'oficina-billing-service';
