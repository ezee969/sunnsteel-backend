// main.ts - Add this at the very top, before any other imports
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) {
	globalThis.crypto = webcrypto as Crypto
}

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'
import * as cookieParser from 'cookie-parser'
import { AllExceptionsFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)

	// Add global exception filter to log all errors
	app.useGlobalFilters(new AllExceptionsFilter())

	app.use(cookieParser())
	app.useGlobalPipes(
		new ValidationPipe({
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	)

	app.setGlobalPrefix('api')

	app.enableCors({
		origin: process.env.FRONTEND_URL || 'http://localhost:3000',
		credentials: true,
	})

	await app.listen(process.env.PORT ?? 4000)
	console.log(
		`🚀 Application is running on: http://localhost:${process.env.PORT ?? 4000}`,
	)
}

void bootstrap()
