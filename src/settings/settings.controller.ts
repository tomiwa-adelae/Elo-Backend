import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('store')
  @ApiOperation({ summary: 'Branding, contact details and policies' })
  getStore() {
    return this.settings.getPublic();
  }

  @Roles(Role.ADMIN)
  @Patch('admin/settings')
  @ApiOperation({ summary: 'Update store branding and settings' })
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}
