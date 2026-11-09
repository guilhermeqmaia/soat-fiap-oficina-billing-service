import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TipoItem } from '../../domain/tipos';

const DINHEIRO = /^\d+\.\d{2}$/;

export class ItemOrcamentoDto {
  @ApiProperty({ enum: TipoItem })
  @IsEnum(TipoItem)
  tipo: TipoItem;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  referenciaId: string;

  @ApiPropertyOptional({ description: 'Servico a que o PRODUTO pertence' })
  @IsOptional()
  @IsString()
  servicoId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  nome: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantidade: number;

  @ApiProperty({ example: '200.00', pattern: DINHEIRO.source })
  @Matches(DINHEIRO, { message: 'precoUnitario deve ser decimal com 2 casas' })
  precoUnitario: string;
}

export class CriarOrcamentoDto {
  @ApiProperty({ example: 'OS-2026-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  numeroOS: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ type: [ItemOrcamentoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemOrcamentoDto)
  itens: ItemOrcamentoDto[];
}

export class CancelarOrcamentoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

export class RejeitarOrcamentoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class OrcamentoGeradoDto {
  @ApiProperty() numeroOS: string;
  @ApiProperty() orcamentoId: string;
  @ApiProperty({ example: '300.00' }) total: string;
  @ApiProperty({ format: 'date-time' }) validoAte: string;
}

export class CobrancaCriadaDto {
  @ApiProperty() numeroOS: string;
  @ApiProperty() orderId: string;
  @ApiProperty() linkPagamento: string;
  @ApiProperty({ example: '300.00' }) valor: string;
}

export class OrcamentoCanceladoDto {
  @ApiProperty() numeroOS: string;
  @ApiProperty({ type: String, nullable: true }) orcamentoId: string | null;
  @ApiProperty() estornado: boolean;
}

export class MotivoDto {
  @ApiProperty() motivo: string;
}

export class CobrancaDto {
  @ApiProperty({ type: String, nullable: true }) orderId: string | null;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, nullable: true }) linkPagamento: string | null;
  @ApiProperty({ example: '300.00' }) valor: string;
}

export class ItemViewDto {
  @ApiProperty({ enum: TipoItem }) tipo: TipoItem;
  @ApiProperty() referenciaId: string;
  @ApiProperty({ type: String, nullable: true }) servicoId: string | null;
  @ApiProperty() nome: string;
  @ApiProperty() quantidade: number;
  @ApiProperty() precoUnitario: string;
}

export class OrcamentoDto {
  @ApiProperty() numeroOS: string;
  @ApiProperty() orcamentoId: string;
  @ApiProperty() clienteId: string;
  @ApiProperty() status: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() total: string;
  @ApiProperty({ format: 'date-time' }) validoAte: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) decididoEm: string | null;
  @ApiProperty({ type: String, nullable: true }) motivoRejeicao: string | null;
  @ApiProperty({ type: [ItemViewDto] }) itens: ItemViewDto[];
  @ApiProperty({
    anyOf: [{ $ref: getSchemaPath(CobrancaDto) }, { type: 'object', nullable: true }],
  })
  cobranca: CobrancaDto | null;
}
