import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';
import request from 'supertest';

import { configureApplication } from '@/app.setup';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

interface ValidationErrorBody {
  error: string;
  message: string[];
  statusCode: number;
}

class SearchQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice!: number;
}

@Controller('contract-probe')
class ContractProbeController {
  @Get()
  @ApiQuery({ name: 'maxPrice', required: true, type: Number, example: 500 })
  @ApiOkResponse({
    schema: {
      example: { maxPrice: 500 },
      properties: { maxPrice: { example: 500, type: 'number' } },
      required: ['maxPrice'],
      type: 'object',
    },
  })
  read(@Query() query: SearchQueryDto): SearchQueryDto {
    return query;
  }
}

describe('configureApplication', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ContractProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('transforms a valid numeric query parameter before it reaches the controller', async () => {
    await request(app.getHttpServer())
      .get('/contract-probe')
      .query({ maxPrice: '500' })
      .expect(200)
      .expect({ maxPrice: 500 });
  });

  it('returns validation details with HTTP 400 for a malformed query parameter', async () => {
    const response = await request(app.getHttpServer())
      .get('/contract-probe')
      .query({ maxPrice: 'abc' })
      .expect(400);
    const body = response.body as ValidationErrorBody;

    expect(body).toMatchObject({ error: 'Bad Request', statusCode: 400 });
    expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('maxPrice')]));
  });

  it('rejects query parameters that are not declared by the DTO', async () => {
    const response = await request(app.getHttpServer())
      .get('/contract-probe')
      .query({ maxPrice: '500', unexpected: 'value' })
      .expect(400);
    const body = response.body as ValidationErrorBody;

    expect(body.message).toContain('property unexpected should not exist');
  });

  it('publishes the API contract as OpenAPI JSON', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = response.body as OpenAPIObject;
    const operation = document.paths['/contract-probe']?.get;

    expect(document.info).toMatchObject({
      description: 'REST API for the HKTutor platform',
      title: 'HKTutor API',
      version: '1.0.0',
    });
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        {
          in: 'query',
          name: 'maxPrice',
          required: true,
          schema: { example: 500, type: 'number' },
        },
      ]),
    );
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            example: { maxPrice: 500 },
            properties: { maxPrice: { example: 500, type: 'number' } },
            required: ['maxPrice'],
            type: 'object',
          },
        },
      },
      description: '',
    });
  });

  it('serves the interactive Swagger UI', async () => {
    await request(app.getHttpServer())
      .get('/api/docs')
      .expect(200)
      .expect('Content-Type', /text\/html/);
  });
});
