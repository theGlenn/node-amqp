import { LoggerInterface } from "../Logger";

const loggerBase = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    silent: jest.fn(),
    level: 'debug',
  };

export const makeMockLogger = (): LoggerInterface => {
  return {
    ...loggerBase,
    // child: jest.fn().mockReturnValue(loggerBase),
  };
}