import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BtsService } from './bts.service';
import { MapQueryDto } from './dto/map-query.dto';

@ApiTags('bts')
@Controller('api/v1/bts')
export class BtsController {
  constructor(private readonly btsService: BtsService) {}

  @Get('map')
  @ApiOperation({ summary: 'GeoJSON BTS trong bounding box (cluster khi zoom < 13)' })
  getForMap(@Query() query: MapQueryDto) {
    return this.btsService.getForMap(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết 1 trạm BTS' })
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.btsService.getDetail(id);
  }
}
