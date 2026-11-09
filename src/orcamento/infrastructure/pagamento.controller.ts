import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Role, Roles } from '@guilhermeqmaia/oficina-kit/auth';
import { ConsultasOrcamentoUseCase } from '../application/use-cases/consultas.use-case';
import { CobrancaDto } from './dto/orcamento.dto';

@ApiTags('Pagamentos')
@ApiBearerAuth()
@Controller('pagamentos')
export class PagamentoController {
  constructor(private readonly consultas: ConsultasOrcamentoUseCase) {}

  @Get(':numeroOS')
  @Roles(Role.CLIENTE, Role.ATENDENTE, Role.ADMIN)
  @ApiOperation({ summary: 'Cobranca vigente da OS, com o link de pagamento' })
  @ApiOkResponse({ type: CobrancaDto })
  @ApiNotFoundResponse({ description: 'Sem cobranca para a OS' })
  buscar(@Param('numeroOS') numeroOS: string, @CurrentUser() usuario: AuthenticatedUser) {
    return this.consultas.pagamento(numeroOS, usuario);
  }
}
