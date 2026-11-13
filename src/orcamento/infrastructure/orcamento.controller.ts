import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedUser, CurrentUser, Role, Roles } from '@guilhermeqmaia/oficina-kit/auth';
import { CancelarOrcamentoUseCase } from '../application/use-cases/cancelar-orcamento.use-case';
import { CobrarOrcamentoUseCase } from '../application/use-cases/cobrar-orcamento.use-case';
import { ConsultasOrcamentoUseCase } from '../application/use-cases/consultas.use-case';
import { DecidirOrcamentoUseCase } from '../application/use-cases/decidir-orcamento.use-case';
import { GerarOrcamentoUseCase } from '../application/use-cases/gerar-orcamento.use-case';
import {
  CancelarOrcamentoDto,
  CobrancaCriadaDto,
  CriarOrcamentoDto,
  MotivoDto,
  OrcamentoCanceladoDto,
  OrcamentoDto,
  OrcamentoGeradoDto,
  RejeitarOrcamentoDto,
} from './dto/orcamento.dto';
import { OrcamentoConflitoFilter } from './orcamento-conflito.filter';

@ApiTags('Orcamentos')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token JWT ausente ou invalido' })
@ApiForbiddenResponse({ description: 'Role sem acesso ou orcamento de outro cliente' })
@UseFilters(OrcamentoConflitoFilter)
@Controller('orcamentos')
export class OrcamentoController {
  constructor(
    private readonly gerar: GerarOrcamentoUseCase,
    private readonly cobrarOrcamento: CobrarOrcamentoUseCase,
    private readonly cancelarOrcamento: CancelarOrcamentoUseCase,
    private readonly decidir: DecidirOrcamentoUseCase,
    private readonly consultas: ConsultasOrcamentoUseCase,
  ) {}

  @Post()
  @Roles(Role.SERVICO)
  @ApiOperation({ summary: 'Gera o orcamento (billing.gerar-orcamento) — role SERVICO' })
  @ApiCreatedResponse({ type: OrcamentoGeradoDto, description: 'billing.orcamento-gerado' })
  @ApiOkResponse({ type: OrcamentoGeradoDto, description: 'Orcamento ativo ja existente' })
  async criar(@Body() dto: CriarOrcamentoDto, @Res({ passthrough: true }) res: Response) {
    const { criado, ...saida } = await this.gerar.execute(dto);
    res.status(criado ? HttpStatus.CREATED : HttpStatus.OK);
    return saida;
  }

  @Post(':numeroOS/cobrar')
  @Roles(Role.SERVICO)
  @ApiOperation({ summary: 'Cria a order no Mercado Pago (billing.cobrar) — role SERVICO' })
  @ApiCreatedResponse({ type: CobrancaCriadaDto, description: 'billing.cobranca-criada' })
  @ApiNotFoundResponse({ description: 'Orcamento inexistente' })
  @ApiConflictResponse({ type: MotivoDto, description: 'Orcamento nao aprovado' })
  cobrar(@Param('numeroOS') numeroOS: string) {
    return this.cobrarOrcamento.execute({ numeroOS });
  }

  @Delete(':numeroOS')
  @Roles(Role.SERVICO)
  @ApiOperation({ summary: 'Cancela o orcamento, idempotente (compensacao) — role SERVICO' })
  @ApiOkResponse({ type: OrcamentoCanceladoDto, description: 'billing.orcamento-cancelado' })
  @ApiConflictResponse({ type: MotivoDto, description: 'Pagamento ja aprovado' })
  cancelar(@Param('numeroOS') numeroOS: string, @Body() dto: CancelarOrcamentoDto) {
    return this.cancelarOrcamento.execute({ numeroOS, motivo: dto.motivo });
  }

  @Post(':numeroOS/aprovar')
  @Roles(Role.CLIENTE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cliente aprova; dispara o callback billing.orcamento-aprovado' })
  @ApiOkResponse({ type: OrcamentoDto })
  @ApiNotFoundResponse({ description: 'Orcamento inexistente' })
  @ApiConflictResponse({ type: MotivoDto, description: 'Orcamento ja decidido ou expirado' })
  aprovar(@Param('numeroOS') numeroOS: string, @CurrentUser() usuario: AuthenticatedUser) {
    return this.decidir.execute({ numeroOS, usuario, decisao: 'APROVAR' });
  }

  @Post(':numeroOS/rejeitar')
  @Roles(Role.CLIENTE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cliente rejeita; dispara o callback billing.orcamento-rejeitado' })
  @ApiOkResponse({ type: OrcamentoDto })
  @ApiNotFoundResponse({ description: 'Orcamento inexistente' })
  @ApiConflictResponse({ type: MotivoDto, description: 'Orcamento ja decidido ou expirado' })
  rejeitar(
    @Param('numeroOS') numeroOS: string,
    @Body() dto: RejeitarOrcamentoDto,
    @CurrentUser() usuario: AuthenticatedUser,
  ) {
    return this.decidir.execute({ numeroOS, usuario, decisao: 'REJEITAR', motivo: dto.motivo });
  }

  @Get()
  @Roles(Role.CLIENTE, Role.ATENDENTE, Role.ADMIN)
  @ApiOperation({ summary: 'Lista orcamentos de um cliente' })
  @ApiQuery({ name: 'clienteId', required: false })
  @ApiOkResponse({ type: [OrcamentoDto] })
  listar(@Query('clienteId') clienteId: string | undefined, @CurrentUser() u: AuthenticatedUser) {
    return this.consultas.listar(clienteId, u);
  }

  @Get(':numeroOS')
  @Roles(Role.CLIENTE, Role.ATENDENTE, Role.ADMIN)
  @ApiOperation({ summary: 'Consulta o orcamento e a cobranca vigente da OS' })
  @ApiOkResponse({ type: OrcamentoDto })
  @ApiNotFoundResponse({ description: 'Orcamento inexistente' })
  buscar(@Param('numeroOS') numeroOS: string, @CurrentUser() usuario: AuthenticatedUser) {
    return this.consultas.buscar(numeroOS, usuario);
  }
}
