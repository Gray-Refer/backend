import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// HMAC verification for Shopify webhooks
// ---------------------------------------------------------------------------
export function verifyShopifyWebhook(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

// ---------------------------------------------------------------------------
// GraphQL client
// ---------------------------------------------------------------------------
async function shopifyGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/2025-01/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: T; errors?: unknown[] };

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Create a fixed-amount discount code via discountCodeBasicCreate
// ---------------------------------------------------------------------------
export interface CreateDiscountResult {
  discountId: string;
  code: string;
}

export async function createShopifyDiscountCode(
  shopDomain: string,
  accessToken: string,
  code: string,
  valueInRupees: number,
  expiresAt?: Date,
): Promise<CreateDiscountResult> {
  const mutation = /* GraphQL */ `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          code
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `GRAY-REFER Reward — ${code}`,
      codes: [code],
      startsAt: new Date().toISOString(),
      ...(expiresAt ? { endsAt: expiresAt.toISOString() } : {}),
      customerGets: {
        value: {
          discountAmount: {
            amount: valueInRupees.toFixed(2),
            appliesOnEach: false,
          },
        },
        items: { all: true },
      },
      customerSelection: { all: true },
      appliesOncePerCustomer: true,
      usageLimit: 1,
    },
  };

  type Response = {
    discountCodeBasicCreate: {
      codeDiscountNode: {
        id: string;
        codeDiscount: {
          codes: { nodes: { code: string }[] };
        };
      } | null;
      userErrors: { field: string[]; code: string; message: string }[];
    };
  };

  const data = await shopifyGraphQL<Response>(shopDomain, accessToken, mutation, variables);
  const result = data.discountCodeBasicCreate;

  if (result.userErrors.length > 0) {
    throw new Error(
      `Shopify discount creation failed: ${result.userErrors.map((e) => e.message).join(', ')}`,
    );
  }

  if (!result.codeDiscountNode) {
    throw new Error('Shopify returned no discount node');
  }

  return {
    discountId: result.codeDiscountNode.id,
    code: result.codeDiscountNode.codeDiscount.codes.nodes[0]?.code ?? code,
  };
}
