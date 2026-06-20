import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  ManagerAccountDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto/login.dto';
import { JwtAuthGuard, type AuthedRequest } from './jwt-auth.guard';

@ApiTags('manager-auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản người quản lý, sinh pairing code' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiConflictResponse({ description: 'Email đã được đăng ký' })
  register(@Body() dto: RegisterDto): Promise<LoginResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập người quản lý, trả về JWT' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Sai email hoặc mật khẩu' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin tài khoản người quản lý từ JWT' })
  @ApiOkResponse({ type: ManagerAccountDto })
  me(@Req() req: AuthedRequest): Promise<ManagerAccountDto> {
    return this.authService.findById(req.managerAccount.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cập nhật thông tin tài khoản người quản lý (sđt liên lạc cho app mobile)',
  })
  @ApiOkResponse({ type: ManagerAccountDto })
  updateMe(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<ManagerAccountDto> {
    return this.authService.updateProfile(req.managerAccount.sub, dto);
  }
}
