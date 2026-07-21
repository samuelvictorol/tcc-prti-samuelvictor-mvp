const { z } = require('./common.dto');

const loginSchema = z.object({
  body: z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(256)
  })
});

const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(20).optional() }).default({})
});

const logoutSchema = refreshSchema;

module.exports = { loginSchema, refreshSchema, logoutSchema };
