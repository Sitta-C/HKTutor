FROM nginx:stable-alpine

ENV PORT=8080
ENV API_INTERNAL_URL=http://api.railway.internal:3001
ENV WEB_INTERNAL_URL=http://web.railway.internal:3000

# Use Railway's DNS at runtime, including IPv6-only private networks. Limit substitution so
# Nginx variables such as $request_uri cannot be replaced by unrelated environment values.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
ENV NGINX_ENVSUBST_FILTER="^(PORT|API_INTERNAL_URL|WEB_INTERNAL_URL|NGINX_LOCAL_RESOLVERS)$"

COPY deploy/railway/nginx.conf.template /etc/nginx/templates/nginx.conf.template

EXPOSE 8080
