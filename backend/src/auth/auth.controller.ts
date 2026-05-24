import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ParentAccountDto,
  RegisterDto,
} from './dto/login.dto';
import { JwtAuthGuard, type AuthedRequest } from './jwt-auth.guard';

@ApiTags('parent-auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản phụ huynh, sinh pairing code' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiConflictResponse({ description: 'Email đã được đăng ký' })
  register(@Body() dto: RegisterDto): Promise<LoginResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập phụ huynh, trả về JWT' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Sai email hoặc mật khẩu' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin tài khoản phụ huynh từ JWT' })
  @ApiOkResponse({ type: ParentAccountDto })
  me(@Req() req: AuthedRequest): Promise<ParentAccountDto> {
    return this.authService.findById(req.parentAccount.sub);
  }
}
