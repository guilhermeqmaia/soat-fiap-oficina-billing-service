import { SERVICE_NAME } from './service-name';

it('expoe o nome do servico (DD_SERVICE ou default)', () =>
  expect(typeof SERVICE_NAME).toBe('string'));
