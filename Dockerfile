# temporary mirror from varesa to circumcent dockerhub ratelimit for now
FROM registry.acl.fi/mirror/node:24

WORKDIR /app
COPY . /app

RUN npm install

CMD ["node", "shout.js"]
