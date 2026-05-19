import { Body, Controller, Post } from '@nestjs/common';
import { AuthPublicService } from './auth.public.service';
import {
  LoginRequestDto,
  LoginResponseDto,
  RegisterRequestDto,
  RegisterResponseDto,
} from './dto/auth.public.dto';
import { ResponseFailedDto } from 'src/lib/dto';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppException } from '@softsensor/common';

@Controller('public/auth')
@ApiTags('Public Authentication')
export class AuthPublicController {
  constructor(private readonly authPublicService: AuthPublicService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiOkResponse({
    type: RegisterResponseDto,
    description: 'Registration successful',
  })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Registration failed',
  })
  async registerController(@Body() args: RegisterRequestDto) {
    return await this.authPublicService.registerService(args);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Login successful' })
  @ApiBadRequestResponse({
    type: ResponseFailedDto,
    description: 'Invalid credentials',
  })
  async loginController(@Body() args: LoginRequestDto) {
    return await this.authPublicService.loginService(args);
  }
}
