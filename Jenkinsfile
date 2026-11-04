
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        AWS_REGION = 'ap-south-1'
        AWS_ACCOUNT_ID = '003720988361'
        ECR_REGISTRY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    }

    stages {

        stage('Checkout GitHub') {
            steps {
                checkout scm
            }
        }

        stage('Check Tools and AWS Access') {
            steps {
                sh '''
                    docker --version
                    docker compose version
                    aws --version
                    aws sts get-caller-identity
                '''
            }
        }

        stage('Validate Docker Compose') {
            steps {
                sh 'docker compose config -q'
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    docker build -t user-service:${BUILD_NUMBER} ./user-service

                    docker build -t product-service:${BUILD_NUMBER} ./product-service

                    docker build -t order-service:${BUILD_NUMBER} ./order-service
                '''
            }
        }

        stage('Verify Docker Images') {
            steps {
                sh '''
                    docker image inspect user-service:${BUILD_NUMBER} > /dev/null
                    docker image inspect product-service:${BUILD_NUMBER} > /dev/null
                    docker image inspect order-service:${BUILD_NUMBER} > /dev/null
                '''
            }
        }

        stage('Login to AWS ECR') {
            steps {
                sh '''
                    set -eu
                    aws ecr get-login-password --region "${AWS_REGION}" > ecr-password.tmp

                    docker login \
                        --username AWS \
                        --password-stdin "${ECR_REGISTRY}" < ecr-password.tmp

                    rm -f ecr-password.tmp
                '''
            }
        }

        stage('Tag Docker Images') {
            steps {
                sh '''
                    for SERVICE in user-service product-service order-service
                    do
                        docker tag "${SERVICE}:${BUILD_NUMBER}" \
                            "${ECR_REGISTRY}/${SERVICE}:${BUILD_NUMBER}"
                    done
                '''
            }
        }

        stage('Push Images to AWS ECR') {
            steps {
                sh '''
                    for SERVICE in user-service product-service order-service
                    do
                        docker push "${ECR_REGISTRY}/${SERVICE}:${BUILD_NUMBER}"
                    done
                '''
            }
        }

        stage('Verify ECR Images') {
            steps {
                sh '''
                    for SERVICE in user-service product-service order-service
                    do
                        aws ecr describe-images \
                            --region "${AWS_REGION}" \
                            --repository-name "${SERVICE}" \
                            --image-ids imageTag="${BUILD_NUMBER}"
                    done
                '''
            }
        }
    }

    post {
        success {
            echo 'SUCCESS: All 3 Docker images pushed to AWS ECR!'
        }

        failure {
            echo 'FAILED: Check Jenkins Console Output.'
        }

        always {
            sh 'rm -f ecr-password.tmp'
            echo 'Jenkins pipeline execution completed.'
        }
    }
}
