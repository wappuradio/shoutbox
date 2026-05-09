FROM node:8.11.4 

WORKDIR /app
COPY . /app

RUN npm install

CMD ["node", "shout.js"]
